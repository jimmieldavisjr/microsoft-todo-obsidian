import { ItemView, WorkspaceLeaf } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type MicrosoftTodoPlugin from "../main";
import { TodoPanel } from "../components/TodoPanel";
import { TodoContextProvider } from "../components/PluginContext";

export const VIEW_TYPE_MICROSOFT_TODO = "microsoft-todo-view";
export const MICROSOFT_TODO_ICON = "check-circle-2";

/**
 * Dockable Obsidian view hosting the React panel.
 *
 * This file stays plain TypeScript (no JSX) so the Obsidian-facing layer reads
 * as ordinary Obsidian API code; the JSX lives in `components/`.
 */
export class MicrosoftTodoView extends ItemView {
	private root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: MicrosoftTodoPlugin) {
		super(leaf);
		this.navigation = false;
	}

	getViewType(): string {
		return VIEW_TYPE_MICROSOFT_TODO;
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
}
