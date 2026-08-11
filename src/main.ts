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
	VIEW_TYPE_MICROSOFT_TODO,
} from "./views/MicrosoftTodoView";
import { AddTaskModal } from "./views/AddTaskModal";
import { describeError, toAppError } from "./errors";
import type { CreateTaskInput, ListSelection } from "./types/microsoft-todo";

/** Microsoft Graph rejects titles longer than this. */
const MAX_TITLE_LENGTH = 255;

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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.buildServices();

		this.registerView(
			VIEW_TYPE_MICROSOFT_TODO,
			(leaf: WorkspaceLeaf) => new MicrosoftTodoView(leaf, this)
		);

		this.addRibbonIcon(MICROSOFT_TODO_ICON, "Microsoft To Do", () => {
			void this.activateView();
		});

		this.registerCommands();
		this.addSettingTab(new MicrosoftTodoSettingTab(this.app, this));

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

	/** Opens the view if needed, reveals it, and optionally switches selection. */
	async activateView(options: { selection?: ListSelection; focus?: boolean } = {}): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MICROSOFT_TODO)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				new Notice("Could not open the Microsoft To Do panel.");
				return;
			}
			await leaf.setViewState({ type: VIEW_TYPE_MICROSOFT_TODO, active: options.focus !== false });
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
			id: "open-my-day",
			name: "Open My Day",
			callback: () => void this.activateView({ selection: { kind: "smart", id: "myDay" } }),
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
				if (!checking) void this.addSelectionAsTask(selection, ctx.file ?? null);
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

	private async addSelectionAsTask(selection: string, file: TFile | null): Promise<void> {
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
			bodyParts.push(this.buildNoteReference(options.file));
		}

		const input: CreateTaskInput = {
			title: options.title.slice(0, MAX_TITLE_LENGTH),
			body: bodyParts.length > 0 ? bodyParts.join("\n\n") : undefined,
		};

		try {
			await this.taskService.createTask(listId, input);
			const listName =
				this.taskService.getState().lists.find((list) => list.id === listId)?.displayName ?? "Microsoft To Do";
			new Notice(`Added "${truncate(input.title, 60)}" to ${listName}.`);
		} catch (error) {
			new Notice(describeError(error));
		}
	}

	/** A pointer back to the note, in whichever style the user configured. */
	private buildNoteReference(file: TFile): string {
		if (this.settings.noteLinkStyle === "path") {
			return `Obsidian note: ${file.path}`;
		}
		const vault = encodeURIComponent(this.app.vault.getName());
		const path = encodeURIComponent(file.path);
		return `Obsidian note: obsidian://open?vault=${vault}&file=${path}`;
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
			if (this.app.workspace.getLeavesOfType(VIEW_TYPE_MICROSOFT_TODO).length === 0) return;
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
