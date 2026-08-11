import { createContext, useContext, useSyncExternalStore } from "react";
import type { App } from "obsidian";
import type MicrosoftTodoPlugin from "../main";
import type { TaskService, TodoState } from "../services/TaskService";

export interface TodoContextValue {
	app: App;
	plugin: MicrosoftTodoPlugin;
	service: TaskService;
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
