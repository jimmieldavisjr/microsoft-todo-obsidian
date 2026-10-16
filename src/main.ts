import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

import { MicrosoftAuth, type StoredAuthSession } from "./auth/MicrosoftAuth";
import { DeviceCodeModal } from "./auth/DeviceCodeModal";
import { GraphClient } from "./graph/GraphClient";
import { TodoApi } from "./graph/TodoApi";
import { PlannerApi } from "./graph/PlannerApi";
import { TaskService } from "./services/TaskService";
import {
	BUNDLED_CLIENT_ID,
	DEFAULT_SETTINGS,
	MicrosoftTodoSettingTab,
	SUPERSEDED_CLIENT_IDS,
	type MicrosoftTodoSettings,
} from "./settings/MicrosoftTodoSettings";
import {
	MICROSOFT_TODO_ICON,
	MicrosoftTodoView,
	VIEW_TYPES,
} from "./views/MicrosoftTodoView";
import type { ViewPlacement } from "./components/PluginContext";
import { AddTaskModal } from "./views/AddTaskModal";
import { describeError, toAppError } from "./errors";
import { createTodoTaskMarkdownLink, showTaskCreatedNotice } from "./util/task-links";
import { buildNoteLinkedResource, buildNoteReference, linkedNotePath } from "./util/note-reference";
import type { ListAppearance } from "./util/appearance";
import type { CreateTaskInput, ListSelection, TaskWithList } from "./types/microsoft-todo";

/** Microsoft Graph rejects titles longer than this. */
const MAX_TITLE_LENGTH = 255;

/**
 * The settings the view renders from. Kept as its own snapshot so React can
 * subscribe to appearance changes without re-rendering on every settings save.
 */
export interface ViewPreferences {
	density: MicrosoftTodoSettings["density"];
	sortField: MicrosoftTodoSettings["sortField"];
	sortDirection: MicrosoftTodoSettings["sortDirection"];
	listAppearance: Record<string, ListAppearance>;
}

/** Obsidian exposes its settings window without typing it in the public API. */
interface SettingsCapableApp {
	setting?: {
		open(): void;
		openTabById(id: string): void;
	};
}

export default class MicrosoftTodoPlugin extends Plugin {
	settings!: MicrosoftTodoSettings;
	auth!: MicrosoftAuth;
	taskService!: TaskService;

	private graph!: GraphClient;
	private api!: TodoApi;
	private autoRefreshHandle: number | null = null;
	/** The editor "Add to note" writes into - the To Do view itself is never one. */
	private lastMarkdownLeaf: WorkspaceLeaf | null = null;

	private preferences!: ViewPreferences;
	private readonly preferenceListeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.buildServices();

		// Two view types, so the main window and the side panel can both be open.
		for (const placement of ["main", "sidebar"] as const) {
			this.registerView(
				VIEW_TYPES[placement],
				(leaf: WorkspaceLeaf) => new MicrosoftTodoView(leaf, this, placement)
			);
		}

		this.addRibbonIcon(MICROSOFT_TODO_ICON, "Microsoft To Do", () => {
			void this.activateView();
		});

		this.registerCommands();
		this.addSettingTab(new MicrosoftTodoSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) this.lastMarkdownLeaf = leaf;
			})
		);

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openOnStartup) void this.activateView({ focus: false });
			this.restartAutoRefresh();
		});
	}

	onunload(): void {
		this.stopAutoRefresh();
		this.taskService?.dispose();
	}

	private buildServices(): void {
		this.auth = new MicrosoftAuth(
			() => ({ clientId: this.settings.clientId, tenantId: this.settings.tenantId }),
			{
				load: () => this.settings.auth,
				save: async (session: StoredAuthSession | null) => {
					this.settings.auth = session;
					await this.saveSettings();
				},
			}
		);
		this.auth.load();

		this.graph = new GraphClient(this.auth);
		this.api = new TodoApi(this.graph);

		this.taskService = new TaskService(
			this.auth,
			this.api,
			new PlannerApi(this.graph),
			() => this.settings,
			(selection: ListSelection) => {
				this.settings.lastSelection = selection;
				void this.saveSettings();
			}
		);
		this.taskService.start();
	}

	/* ---------------------------------------------------------------------- */
	/* Settings                                                               */
	/* ---------------------------------------------------------------------- */

	async loadSettings(): Promise<void> {
		// loadData is typed `any`; narrow it before merging so the spread can't
		// quietly widen the settings type.
		const saved = ((await this.loadData()) ?? {}) as Partial<MicrosoftTodoSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Nested objects would otherwise be shared with DEFAULT_SETTINGS.
		this.settings.listAppearance = { ...(saved.listAppearance ?? {}) };
		this.preferences = this.readPreferences();

		// A saved value always beats the default, so two cases need rescuing:
		// installs from before the plugin shipped a registration (empty), and
		// installs pinned to a registration we used to ship. Neither was a choice
		// the user made, and leaving either alone strands them on a dead app.
		const savedClientId = this.settings.clientId.trim();
		if (!savedClientId || SUPERSEDED_CLIENT_IDS.includes(savedClientId)) {
			this.settings.clientId = BUNDLED_CLIENT_ID;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/* ---------------------------------------------------------------------- */
	/* View preferences                                                       */
	/* ---------------------------------------------------------------------- */

	private readPreferences(): ViewPreferences {
		const { density, sortField, sortDirection, listAppearance } = this.settings;
		return { density, sortField, sortDirection, listAppearance };
	}

	subscribePreferences = (listener: () => void): (() => void) => {
		this.preferenceListeners.add(listener);
		return () => this.preferenceListeners.delete(listener);
	};

	getPreferences = (): ViewPreferences => this.preferences;

	/** Call after changing any appearance setting so open views re-render. */
	notifyAppearanceChanged(): void {
		this.preferences = this.readPreferences();
		for (const listener of this.preferenceListeners) listener();
	}

	async updatePreferences(changes: Partial<ViewPreferences>): Promise<void> {
		Object.assign(this.settings, changes);
		this.notifyAppearanceChanged();
		await this.saveSettings();
	}

	async setListAppearance(listId: string, appearance: ListAppearance | null): Promise<void> {
		const next = { ...this.settings.listAppearance };
		if (appearance) next[listId] = appearance;
		else delete next[listId];
		await this.updatePreferences({ listAppearance: next });
	}

	/** The stored tokens belong to one app registration; a config change voids them. */
	async handleAuthConfigChanged(): Promise<void> {
		await this.auth.invalidate();
		this.auth.load();
		this.taskService.notifySettingsChanged();
	}

	openSettings(): void {
		const setting = (this.app as unknown as SettingsCapableApp).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	/* ---------------------------------------------------------------------- */
	/* Authentication                                                         */
	/* ---------------------------------------------------------------------- */

	/** Runs the device code flow. Reports its own errors; returns success. */
	async signIn(): Promise<boolean> {
		if (!this.auth.isConfigured) {
			new Notice("Add your Azure application (client) ID in the Microsoft To Do settings first.");
			this.openSettings();
			return false;
		}

		const controller = new AbortController();
		const modal = new DeviceCodeModal(this.app, () => controller.abort());
		modal.open();

		try {
			const account = await this.auth.signIn((prompt) => modal.showPrompt(prompt), controller.signal);
			modal.showSuccess(account);
			new Notice(`Connected to Microsoft To Do as ${account.name}.`);
			await this.taskService.refresh({ force: true });
			return true;
		} catch (error) {
			modal.dismiss();
			const appError = toAppError(error);
			// The user closing the dialog is not something to report back to them.
			if (appError.kind !== "cancelled") new Notice(describeError(appError));
			return false;
		}
	}

	async signOut(): Promise<void> {
		await this.auth.signOut();
		new Notice("Disconnected from Microsoft To Do.");
	}

	/* ---------------------------------------------------------------------- */
	/* View                                                                   */
	/* ---------------------------------------------------------------------- */

	/** Where the ribbon icon and the plain "Open" command go. */
	get defaultPlacement(): ViewPlacement {
		return this.settings.openLocation === "sidebar" ? "sidebar" : "main";
	}

	/**
	 * Opens the view in the main window or the side panel if it isn't already
	 * there, reveals it, and optionally switches selection.
	 */
	async activateView(
		options: { placement?: ViewPlacement; selection?: ListSelection; focus?: boolean } = {}
	): Promise<void> {
		const { workspace } = this.app;
		const placement = options.placement ?? this.defaultPlacement;
		const type = VIEW_TYPES[placement];

		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;

		if (!leaf) {
			leaf = placement === "sidebar" ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
			if (!leaf) {
				new Notice("Could not open Microsoft To Do.");
				return;
			}
			await leaf.setViewState({ type, active: options.focus !== false });
		}

		// revealLeaf returns a promise as of Obsidian 1.7.2, which is why
		// minAppVersion sits there rather than lower.
		if (options.focus !== false) await workspace.revealLeaf(leaf);
		if (options.selection) await this.taskService.select(options.selection);
	}

	/* ---------------------------------------------------------------------- */
	/* Commands                                                               */
	/* ---------------------------------------------------------------------- */

	private registerCommands(): void {
		// Obsidian prefixes each name with the plugin name, producing
		// "Microsoft To Do: Open" and friends in the Command Palette.
		this.addCommand({
			id: "open",
			name: "Open",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "open-main",
			name: "Open in main window",
			callback: () => void this.activateView({ placement: "main" }),
		});

		this.addCommand({
			id: "open-sidebar",
			name: "Open in side panel",
			callback: () => void this.activateView({ placement: "sidebar" }),
		});

		// The id predates the rename to "Today"; keeping it preserves hotkeys.
		this.addCommand({
			id: "open-my-day",
			name: "Open Today",
			callback: () => void this.activateView({ selection: { kind: "smart", id: "myDay" } }),
		});

		this.addCommand({
			id: "open-my-tasks",
			name: "Open My Tasks",
			callback: () => void this.activateView({ selection: { kind: "smart", id: "all" } }),
		});

		this.addCommand({
			id: "add-task",
			name: "Add task",
			callback: () => void this.openAddTaskModal(),
		});

		this.addCommand({
			id: "add-selected-text",
			name: "Add selected text as task",
			editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const selection = editor.getSelection();
				if (!selection.trim()) return false;
				if (!checking) void this.addSelectionAsTask(selection, editor, ctx.file ?? null);
				return true;
			},
		});

		this.addCommand({
			id: "add-current-note",
			name: "Add current note as task",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.addNoteAsTask(file);
				return true;
			},
		});

		this.addCommand({
			id: "refresh",
			name: "Refresh",
			callback: () => void this.refreshFromCommand(),
		});

		this.addCommand({
			id: "connect-account",
			name: "Sign in to Microsoft",
			checkCallback: (checking: boolean) => {
				if (this.auth.isSignedIn) return false;
				if (!checking) void this.signIn();
				return true;
			},
		});

		this.addCommand({
			id: "disconnect-account",
			name: "Sign out",
			checkCallback: (checking: boolean) => {
				if (!this.auth.isSignedIn) return false;
				if (!checking) void this.signOut();
				return true;
			},
		});
	}

	private async refreshFromCommand(): Promise<void> {
		if (!(await this.ensureReady())) return;
		await this.taskService.refresh({ force: true, background: true });

		const error = this.taskService.getState().error;
		new Notice(error ? describeError(error) : "Microsoft To Do refreshed.");
	}

	private async openAddTaskModal(): Promise<void> {
		if (!(await this.ensureReady())) return;
		new AddTaskModal(this.app, this.taskService).open();
	}

	/* ---------------------------------------------------------------------- */
	/* Obsidian -> To Do                                                      */
	/* ---------------------------------------------------------------------- */

	private async addSelectionAsTask(selection: string, editor: Editor, file: TFile | null): Promise<void> {
		const lines = selection.split("\n");
		const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
		if (firstContentLine === -1) return;

		const title = toTaskTitle(lines[firstContentLine]);
		if (!title) {
			new Notice("The selection has no text to use as a task title.");
			return;
		}

		// Anything after the first line becomes the task's notes.
		const remainder = lines
			.slice(firstContentLine + 1)
			.join("\n")
			.trim();

		await this.createTaskFromObsidian({
			title,
			notes: remainder,
			file,
			preferredListId: this.settings.selectedTextListId,
			selectedText: { editor, value: selection, title: title.slice(0, MAX_TITLE_LENGTH) },
		});
	}

	private async addNoteAsTask(file: TFile): Promise<void> {
		await this.createTaskFromObsidian({
			title: file.basename,
			notes: "",
			file,
			preferredListId: this.settings.currentNoteListId,
		});
	}

	private async createTaskFromObsidian(options: {
		title: string;
		notes: string;
		file: TFile | null;
		preferredListId: string;
		selectedText?: { editor: Editor; value: string; title: string };
	}): Promise<void> {
		if (!(await this.ensureReady())) return;

		const listId = this.taskService.resolveTargetListId(options.preferredListId || undefined);
		if (!listId) {
			new Notice("No Microsoft To Do list is available to add this task to.");
			return;
		}

		const bodyParts: string[] = [];
		if (options.notes) bodyParts.push(options.notes);
		if (this.settings.addNoteLink && options.file) {
			bodyParts.push(buildNoteReference(this.app.vault.getName(), options.file.path, this.settings.noteLinkStyle));
		}

		const input: CreateTaskInput = {
			title: options.title.slice(0, MAX_TITLE_LENGTH),
			body: bodyParts.length > 0 ? bodyParts.join("\n\n") : undefined,
		};

		try {
			const task = await this.taskService.createTask(listId, input);
			const listName =
				this.taskService.getState().lists.find((list) => list.id === listId)?.displayName ?? "Microsoft To Do";
			showTaskCreatedNotice(`Added "${truncate(input.title, 60)}" to ${listName}.`, task.id);
			if (this.settings.addNoteLink && options.file) {
				// Also recorded as a linked resource, which is what the view's
				// "Linked notes" section reads. Best effort: the task exists either way.
				await this.taskService
					.addLinkedResource(
						{ ...task, listId, listName, source: "todo" },
						buildNoteLinkedResource(this.app.vault.getName(), options.file)
					)
					.catch(() => undefined);
			}
			if (this.settings.formatSelectedTextAsLink && options.selectedText) {
				this.linkSelectedText(
					options.selectedText.editor,
					options.selectedText.value,
					options.selectedText.title,
					task.id
				);
			}
		} catch (error) {
			new Notice(describeError(error));
		}
	}

	private linkSelectedText(editor: Editor, selectedText: string, title: string, taskId: string): void {
		if (editor.getSelection() !== selectedText) {
			new Notice("Task created, but the selection changed before it could be linked.");
			return;
		}

		const lines = selectedText.split("\n");
		const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
		const rawTitleLine = firstContentLine === -1 ? "" : lines[firstContentLine];
		const titleStart = rawTitleLine.lastIndexOf(title);
		if (firstContentLine === -1 || titleStart === -1) {
			new Notice("Task created, but the selected text could not be linked.");
			return;
		}

		lines[firstContentLine] =
			rawTitleLine.slice(0, titleStart) +
			createTodoTaskMarkdownLink(title, taskId) +
			rawTitleLine.slice(titleStart + title.length);
		editor.replaceSelection(lines.join("\n"));
	}

	/**
	 * The editor the user was most recently in. Focus is usually on the To Do
	 * view when this is asked, so the active view can't answer it.
	 */
	private recentMarkdownView(): MarkdownView | null {
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		const leaf =
			this.lastMarkdownLeaf && markdownLeaves.includes(this.lastMarkdownLeaf)
				? this.lastMarkdownLeaf
				: (markdownLeaves[0] ?? null);
		return leaf?.view instanceof MarkdownView ? leaf.view : null;
	}

	/** The note most recently edited - offered first when linking notes to a task. */
	getRecentNote(): TFile | null {
		return this.recentMarkdownView()?.file ?? null;
	}

	/**
	 * Writes a Markdown link to `task` at the cursor of the note most recently
	 * edited, then records that note as linked to the task. Returns the note, or
	 * `null` (having told the user why) when there was nowhere to write.
	 */
	async insertTaskLinkIntoNote(task: TaskWithList): Promise<TFile | null> {
		const view = this.recentMarkdownView();
		const file = view?.file ?? null;

		if (!view || !file) {
			new Notice("Open a note first, then use Add to note.");
			return null;
		}

		view.editor.replaceSelection(createTodoTaskMarkdownLink(task.title, task.id));

		const alreadyLinked = (task.linkedResources ?? []).some((resource) => linkedNotePath(resource) === file.path);
		if (!alreadyLinked && task.source === "todo") {
			try {
				await this.taskService.addLinkedResource(task, buildNoteLinkedResource(this.app.vault.getName(), file));
			} catch (error) {
				new Notice(`Link added to ${file.basename}, but the task could not record it: ${describeError(error)}`);
				return file;
			}
		}

		new Notice(`Added a link to "${truncate(task.title, 60)}" in ${file.basename}.`);
		return file;
	}

	/**
	 * Guards every command that talks to Graph: configured, signed in, and with
	 * lists loaded so a target list can be resolved.
	 */
	private async ensureReady(): Promise<boolean> {
		if (!this.auth.isConfigured) {
			new Notice("Add your Azure application (client) ID in the Microsoft To Do settings first.");
			this.openSettings();
			return false;
		}

		if (!this.auth.isSignedIn) {
			new Notice("Connect your Microsoft account to use Microsoft To Do.");
			return this.signIn();
		}

		if (this.taskService.getState().lists.length === 0) {
			await this.taskService.refresh({ force: true, background: true });
		}

		const state = this.taskService.getState();
		if (state.lists.length === 0) {
			new Notice(state.error ? describeError(state.error) : "No Microsoft To Do lists were found.");
			return false;
		}

		return true;
	}

	/* ---------------------------------------------------------------------- */
	/* Auto refresh                                                           */
	/* ---------------------------------------------------------------------- */

	restartAutoRefresh(): void {
		this.stopAutoRefresh();

		const minutes = this.settings.autoRefreshMinutes;
		if (minutes <= 0) return;

		const handle = window.setInterval(() => {
			if (!this.auth.isSignedIn) return;
			// Nothing on screen to update - don't spend requests.
			const open = Object.values(VIEW_TYPES).some((type) => this.app.workspace.getLeavesOfType(type).length > 0);
			if (!open) return;
			void this.taskService.refresh({ force: true, background: true });
		}, minutes * 60_000);

		this.autoRefreshHandle = handle;
		this.registerInterval(handle);
	}

	private stopAutoRefresh(): void {
		if (this.autoRefreshHandle !== null) {
			window.clearInterval(this.autoRefreshHandle);
			this.autoRefreshHandle = null;
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Turns a line of Markdown into something that reads as a task title. */
function toTaskTitle(line: string): string {
	return line
		.replace(/^\s*[-*+]\s+\[[^\]]?\]\s*/, "") // task checkbox
		.replace(/^\s*[-*+]\s+/, "") // bullet
		.replace(/^\s*\d+[.)]\s+/, "") // ordered item
		.replace(/^\s*#{1,6}\s+/, "") // heading
		.replace(/^\s*>\s?/, "") // block quote
		.trim();
}

function truncate(value: string, length: number): string {
	return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
