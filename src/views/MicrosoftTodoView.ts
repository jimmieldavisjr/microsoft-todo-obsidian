import { ItemView, Scope, WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type MicrosoftTodoPlugin from "../main";
import { TodoPanel } from "../components/TodoPanel";
import { TodoContextProvider, type ViewCommand, type ViewPlacement } from "../components/PluginContext";

/** The main-window view. The ID predates the side panel and is kept so saved layouts still open. */
export const VIEW_TYPE_MICROSOFT_TODO = "microsoft-todo-view";
export const VIEW_TYPE_MICROSOFT_TODO_SIDEBAR = "microsoft-todo-sidebar";
export const MICROSOFT_TODO_ICON = "check-circle-2";

export const VIEW_TYPES: Record<ViewPlacement, string> = {
	main: VIEW_TYPE_MICROSOFT_TODO,
	sidebar: VIEW_TYPE_MICROSOFT_TODO_SIDEBAR,
};

/**
 * Dockable Obsidian view hosting the React panel.
 *
 * The main window and the side panel are separate view types so both can be
 * open at once; they render the same component tree over the same service,
 * and the layout adapts to whichever width it lands in.
 *
 * This file stays plain TypeScript (no JSX) so the Obsidian-facing layer reads
 * as ordinary Obsidian API code; the JSX lives in `components/`.
 */
export class MicrosoftTodoView extends ItemView {
	private root: Root | null = null;
	private readonly commands = new EventTarget();

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: MicrosoftTodoPlugin,
		private readonly placement: ViewPlacement
	) {
		super(leaf);
		this.navigation = false;

		// A view-level scope is only active while this view has focus, so these
		// never shadow the editor's own Mod+K.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "k", () => this.send("focus-search"));
		this.scope.register(["Mod"], "Enter", () => this.send("new-task"));
	}

	getViewType(): string {
		return VIEW_TYPES[this.placement];
	}

	getDisplayText(): string {
		return "Microsoft To Do";
	}

	getIcon(): string {
		return MICROSOFT_TODO_ICON;
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("mstd-view");

		this.root = createRoot(container);
		this.root.render(
			createElement(
				TodoContextProvider,
				{
					value: {
						app: this.app,
						plugin: this.plugin,
						service: this.plugin.taskService,
						commands: this.commands,
						placement: this.placement,
					},
				},
				createElement(TodoPanel)
			)
		);

		if (this.plugin.settings.refreshOnOpen) {
			// Not awaited: the panel renders its own loading state.
			void this.plugin.taskService.refresh();
		}
	}

	async onClose(): Promise<void> {
		// React 18 warns if unmount happens during its own commit phase.
		const root = this.root;
		this.root = null;
		if (root) window.setTimeout(() => root.unmount(), 0);
	}

	/** Returning false stops Obsidian running any other handler for the key. */
	private send(command: ViewCommand): false {
		this.commands.dispatchEvent(new Event(command));
		return false;
	}
}
