import { Menu, Notice } from "obsidian";
import type MicrosoftTodoPlugin from "../main";
import type { TaskService } from "../services/TaskService";
import { describeError } from "../errors";
import { addDays, startOfToday } from "../util/date";
import { getTodoTaskUrl, TODO_WEB_URL } from "../util/task-links";
import { confirmAction, ListSuggestModal } from "../views/modals";
import type { TaskWithList } from "../types/microsoft-todo";

/**
 * Task actions shared by the row context menu and the detail pane, so the two
 * entry points can't drift apart in wording or behaviour.
 */

/**
 * Runs a mutation, surfacing a failure as a Notice. The service has already
 * rolled back any optimistic change by the time this reports.
 */
export async function run(action: () => Promise<unknown>): Promise<boolean> {
	try {
		await action();
		return true;
	} catch (error) {
		new Notice(describeError(error));
		return false;
	}
}

/** Planner tasks have no To Do deep link; To Do shows them under "Assigned to me". */
export function taskWebUrl(task: TaskWithList): string {
	return task.source === "planner" ? `${TODO_WEB_URL}/tasks/assigned_to_me` : getTodoTaskUrl(task.id);
}

export async function deleteTaskWithConfirm(
	plugin: MicrosoftTodoPlugin,
	service: TaskService,
	task: TaskWithList
): Promise<boolean> {
	const confirmed = await confirmAction(plugin.app, {
		title: "Delete task",
		message: `"${task.title}" will be permanently deleted from Microsoft To Do.`,
		confirmText: "Delete",
		destructive: true,
	});
	if (!confirmed) return false;
	return run(() => service.deleteTask(task));
}

/**
 * Opens the list picker and moves the task. Resolves with the moved task's new
 * ID - Graph can't move a task, so it's recreated - or `null` if nothing moved.
 */
export function moveTaskWithPicker(
	plugin: MicrosoftTodoPlugin,
	service: TaskService,
	task: TaskWithList
): Promise<string | null> {
	const lists = service.getState().lists.filter(
		(list) => list.id !== task.listId && list.wellknownListName !== "flaggedEmails"
	);
	return new Promise((resolve) => {
		new ListSuggestModal(plugin.app, lists, (list) => {
			void moveTask(service, task, list.id).then(resolve);
		}).open();
	});
}

export async function moveTask(service: TaskService, task: TaskWithList, listId: string): Promise<string | null> {
	try {
		const moved = await service.moveTask(task, listId);
		const listName = service.getState().lists.find((list) => list.id === listId)?.displayName ?? "list";
		new Notice(`Moved "${task.title}" to ${listName}.`);
		return moved.id;
	} catch (error) {
		new Notice(describeError(error));
		return null;
	}
}

export async function copyTaskLink(task: TaskWithList): Promise<void> {
	try {
		await navigator.clipboard.writeText(taskWebUrl(task));
		new Notice("Task link copied.");
	} catch {
		new Notice("Could not copy the link to the clipboard.");
	}
}

/**
 * The right-click menu for a task row. `onSelect` re-points the selection after
 * a move, since the task comes back with a new ID.
 */
export function showTaskMenu(
	event: MouseEvent,
	plugin: MicrosoftTodoPlugin,
	service: TaskService,
	task: TaskWithList,
	onSelect: (taskId: string | null) => void
): void {
	const menu = new Menu();
	const readOnly = task.source !== "todo";
	const completed = task.status === "completed";
	const important = task.importance === "high";

	menu.addItem((item) =>
		item
			.setTitle(completed ? "Mark as not completed" : "Mark as completed")
			.setIcon(completed ? "circle" : "check-circle-2")
			.setDisabled(readOnly)
			.onClick(() => void run(() => service.setCompleted(task, !completed)))
	);
	menu.addItem((item) =>
		item
			.setTitle(important ? "Remove importance" : "Mark as important")
			.setIcon("star")
			.setDisabled(readOnly)
			.onClick(() => void run(() => service.setImportance(task, important ? "normal" : "high")))
	);

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Due today")
			.setIcon("sun")
			.setDisabled(readOnly)
			.onClick(() => void run(() => service.updateTask(task, { dueDate: startOfToday() })))
	);
	menu.addItem((item) =>
		item
			.setTitle("Due tomorrow")
			.setIcon("sunrise")
			.setDisabled(readOnly)
			.onClick(() => void run(() => service.updateTask(task, { dueDate: addDays(startOfToday(), 1) })))
	);
	if (task.dueDateTime) {
		menu.addItem((item) =>
			item
				.setTitle("Remove due date")
				.setIcon("calendar-x")
				.setDisabled(readOnly)
				.onClick(() => void run(() => service.updateTask(task, { dueDate: null })))
		);
	}

	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle("Move to list…")
			.setIcon("folder-input")
			.setDisabled(readOnly)
			.onClick(() => {
				void moveTaskWithPicker(plugin, service, task).then((id) => {
					if (id) onSelect(id);
				});
			})
	);
	menu.addItem((item) =>
		item
			.setTitle("Add link to note")
			.setIcon("file-plus")
			.setDisabled(readOnly)
			.onClick(() => void plugin.insertTaskLinkIntoNote(task))
	);
	menu.addItem((item) => item.setTitle("Copy link").setIcon("link").onClick(() => void copyTaskLink(task)));
	menu.addItem((item) =>
		item
			.setTitle("Open in Microsoft To Do")
			.setIcon("external-link")
			.onClick(() => window.open(taskWebUrl(task), "_blank"))
	);

	if (!readOnly) {
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete task")
				.setIcon("trash-2")
				.setWarning(true)
				.onClick(() => {
					void deleteTaskWithConfirm(plugin, service, task).then((deleted) => {
						if (deleted) onSelect(null);
					});
				})
		);
	}

	menu.showAtMouseEvent(event);
}
