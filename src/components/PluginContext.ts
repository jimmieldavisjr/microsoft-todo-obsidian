import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { App } from "obsidian";
import type MicrosoftTodoPlugin from "../main";
import type { ViewPreferences } from "../main";
import type { TaskService, TodoState } from "../services/TaskService";

/** Keyboard commands the Obsidian view forwards into the React tree. */
export type ViewCommand = "focus-search" | "new-task";

/** Where a view lives: a main editor tab, or the right side panel. */
export type ViewPlacement = "main" | "sidebar";

export interface TodoContextValue {
	app: App;
	plugin: MicrosoftTodoPlugin;
	service: TaskService;
	/** Carries `ViewCommand`s from the view's keymap scope to whoever handles them. */
	commands: EventTarget;
	placement: ViewPlacement;
}

const TodoContext = createContext<TodoContextValue | null>(null);

export const TodoContextProvider = TodoContext.Provider;

export function useTodoContext(): TodoContextValue {
	const value = useContext(TodoContext);
	if (!value) throw new Error("useTodoContext must be used inside the Microsoft To Do view.");
	return value;
}

/** Subscribes the component tree to the service's state snapshot. */
export function useTodoState(): TodoState {
	const { service } = useTodoContext();
	return useSyncExternalStore(service.subscribe, service.getState, service.getState);
}

/** Subscribes to the appearance settings: density, sort, list colours. */
export function usePreferences(): ViewPreferences {
	const { plugin } = useTodoContext();
	return useSyncExternalStore(plugin.subscribePreferences, plugin.getPreferences, plugin.getPreferences);
}

/** Runs `handler` whenever the view forwards `command`. */
export function useViewCommand(command: ViewCommand, handler: () => void): void {
	const { commands } = useTodoContext();
	useEffect(() => {
		const listener = (): void => handler();
		commands.addEventListener(command, listener);
		return () => commands.removeEventListener(command, listener);
	}, [commands, command, handler]);
}
