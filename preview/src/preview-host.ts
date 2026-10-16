// The shim *is* "obsidian" in the preview build; importing it by path just
// gives us its own constructor signatures for building fake files.
import { Notice, TFile } from "./obsidian-shim";
import type { App, TFile as VaultFile } from "obsidian";
import type MicrosoftTodoPlugin from "../../src/main";
import type { ViewPreferences } from "../../src/main";
import type { AccountInfo, MicrosoftAuth } from "../../src/auth/MicrosoftAuth";
import type { GraphClient } from "../../src/graph/GraphClient";
import { TodoApi } from "../../src/graph/TodoApi";
import { PlannerApi } from "../../src/graph/PlannerApi";
import { TaskService } from "../../src/services/TaskService";
import { DEFAULT_SETTINGS, type MicrosoftTodoSettings } from "../../src/settings/MicrosoftTodoSettings";
import type { ViewPlacement } from "../../src/components/PluginContext";
import type { ListAppearance } from "../../src/util/appearance";
import { buildNoteLinkedResource, linkedNotePath } from "../../src/util/note-reference";
import { createTodoTaskMarkdownLink } from "../../src/util/task-links";
import type { TaskWithList } from "../../src/types/microsoft-todo";
import { FakeGraph } from "./fake-graph";
import { DEMO_VAULT, NOTES } from "./demo-vault";

/**
 * Stands in for Obsidian and the plugin's `main.ts` around the real UI.
 *
 * The data path is the real one: `TaskService` -> `TodoApi`/`PlannerApi` ->
 * (in-memory Graph). What's simulated is the host: the workspace, the vault,
 * sign-in, and the handful of plugin methods the components call.
 */

/* -------------------------------------------------------------------------- */
/* Workspace state the preview chrome renders                                 */
/* -------------------------------------------------------------------------- */

export type AuthMode = "signed-in" | "signed-out" | "unconfigured";

export interface WorkspaceState {
	/** What the main window's active tab shows: `"todo"` for Microsoft To Do, or a note path. */
	mainTab: string;
	mainTodoOpen: boolean;
	sidebarOpen: boolean;
	/** Briefly set when a view is revealed, so the chrome can highlight it. */
	flash: ViewPlacement | null;
	notes: Record<string, string>;
}

class Store<T> {
	private listeners = new Set<() => void>();
	constructor(private value: T) {}
	get = (): T => this.value;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	set(changes: Partial<T>): void {
		this.value = { ...this.value, ...changes };
		for (const listener of this.listeners) listener();
	}
}

export const workspace = new Store<WorkspaceState>({
	mainTab: "todo",
	mainTodoOpen: true,
	sidebarOpen: true,
	flash: null,
	notes: Object.fromEntries(NOTES.map((note) => [note.path, note.content])),
});

let flashTimer: number | undefined;

export function revealView(placement: ViewPlacement): void {
	if (placement === "main") workspace.set({ mainTodoOpen: true, mainTab: "todo", flash: "main" });
	else workspace.set({ sidebarOpen: true, flash: "sidebar" });
	window.clearTimeout(flashTimer);
	flashTimer = window.setTimeout(() => workspace.set({ flash: null }), 700);
}

export function openNote(path: string): void {
	workspace.set({ mainTab: path });
}

/* -------------------------------------------------------------------------- */
/* Vault                                                                      */
/* -------------------------------------------------------------------------- */

export const files = NOTES.map((note) => {
	const file = new TFile(note.path);
	file.stat.mtime = Date.now() - NOTES.indexOf(note) * 3_600_000;
	return file;
});

const fileByPath = (path: string): TFile | null => files.find((file) => file.path === path) ?? null;

const mostRecentLeaf = {
	get view() {
		const type = workspace.get().mainTab === "todo" ? "microsoft-todo-view" : "markdown";
		return { getViewType: () => type };
	},
	openFile: async (file: TFile) => openNote(file.path),
};

export const app = {
	vault: {
		getName: () => DEMO_VAULT,
		getMarkdownFiles: () => files,
		getAbstractFileByPath: fileByPath,
	},
	metadataCache: {
		getCache: (path: string) => {
			const description = NOTES.find((note) => note.path === path)?.description;
			return description ? { frontmatter: { description } } : null;
		},
		getFirstLinkpathDest: (link: string) =>
			files.find((file) => file.basename === link || file.path === link) ?? null,
	},
	workspace: {
		getMostRecentLeaf: () => mostRecentLeaf,
		getLeaf: () => mostRecentLeaf,
	},
} as unknown as App;

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                    */
/* -------------------------------------------------------------------------- */

class FakeAuth {
	private listeners = new Set<() => void>();
	mode: AuthMode = "signed-in";
	readonly account: AccountInfo = { name: "Alex Rivera", username: "alex@contoso.com" };

	get isConfigured(): boolean {
		return this.mode !== "unconfigured";
	}
	get isSignedIn(): boolean {
		return this.mode === "signed-in";
	}
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	setMode(mode: AuthMode): void {
		this.mode = mode;
		for (const listener of this.listeners) listener();
	}
}

export const auth = new FakeAuth();
export const graph = new FakeGraph();

/* -------------------------------------------------------------------------- */
/* Plugin                                                                     */
/* -------------------------------------------------------------------------- */

const settings: MicrosoftTodoSettings = { ...DEFAULT_SETTINGS, listAppearance: {} };

export const service = new TaskService(
	auth as unknown as MicrosoftAuth,
	new TodoApi(graph as unknown as GraphClient),
	new PlannerApi(graph as unknown as GraphClient),
	() => settings,
	(selection) => (settings.lastSelection = selection)
);
service.start();

function readPreferences(): ViewPreferences {
	const { density, sortField, sortDirection, listAppearance } = settings;
	return { density, sortField, sortDirection, listAppearance };
}

let preferences = readPreferences();
const preferenceListeners = new Set<() => void>();

/** The members of `MicrosoftTodoPlugin` the components reach for, mirrored from `main.ts`. */
const previewPlugin = {
	app,
	settings,
	taskService: service,

	subscribePreferences: (listener: () => void) => {
		preferenceListeners.add(listener);
		return () => preferenceListeners.delete(listener);
	},
	getPreferences: () => preferences,
	notifyAppearanceChanged() {
		preferences = readPreferences();
		for (const listener of preferenceListeners) listener();
	},
	async updatePreferences(changes: Partial<ViewPreferences>) {
		Object.assign(settings, changes);
		previewPlugin.notifyAppearanceChanged();
	},
	async setListAppearance(listId: string, appearance: ListAppearance | null) {
		const next = { ...settings.listAppearance };
		if (appearance) next[listId] = appearance;
		else delete next[listId];
		await previewPlugin.updatePreferences({ listAppearance: next });
	},

	get defaultPlacement(): ViewPlacement {
		return settings.openLocation === "sidebar" ? "sidebar" : "main";
	},
	async activateView(options: { placement?: ViewPlacement } = {}) {
		revealView(options.placement ?? previewPlugin.defaultPlacement);
	},

	openSettings() {
		new Notice("In Obsidian, this opens Settings → Microsoft To Do.");
	},
	async signIn() {
		new Notice("Signing in… (simulated device code flow)");
		await new Promise((resolve) => window.setTimeout(resolve, 600));
		auth.setMode("signed-in");
		new Notice(`Connected to Microsoft To Do as ${auth.account.name}.`);
		await service.refresh({ force: true });
		return true;
	},

	getRecentNote(): TFile | null {
		const tab = workspace.get().mainTab;
		return fileByPath(tab === "todo" ? "Daily/Today.md" : tab);
	},
	async insertTaskLinkIntoNote(task: TaskWithList) {
		const file = previewPlugin.getRecentNote();
		if (!file) return null;
		const notes = workspace.get().notes;
		workspace.set({
			notes: { ...notes, [file.path]: `${notes[file.path] ?? ""}- ${createTodoTaskMarkdownLink(task.title, task.id)}\n` },
		});
		const alreadyLinked = (task.linkedResources ?? []).some((resource) => linkedNotePath(resource) === file.path);
		if (!alreadyLinked && task.source === "todo") {
			await service.addLinkedResource(task, buildNoteLinkedResource(DEMO_VAULT, file as unknown as VaultFile));
		}
		new Notice(`Added a link to "${task.title}" in ${file.basename}.`);
		return file;
	},
};

export const plugin = previewPlugin as unknown as MicrosoftTodoPlugin;

export function setAuthMode(mode: AuthMode): void {
	auth.setMode(mode);
	if (mode === "signed-in") void service.refresh({ force: true });
}

export async function resetDemoData(): Promise<void> {
	graph.reset();
	await service.refresh({ force: true });
	new Notice("Demo data restored.");
}
