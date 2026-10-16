import type { GraphClient } from "./GraphClient";
import { toGraphDate } from "../util/date";
import { toAppError } from "../errors";
import type {
	ChecklistItem,
	CreateTaskInput,
	LinkedResource,
	LinkedResourceInput,
	TodoTask,
	TodoTaskList,
	UpdateTaskInput,
} from "../types/microsoft-todo";

/**
 * Adapter between the plugin's task vocabulary and the Microsoft To Do endpoints
 * of Microsoft Graph.
 *
 * Everything above this file speaks in `TodoTask`/`TodoTaskList` and plain
 * `Date`s; everything below speaks HTTP and `DateTimeTimeZone`.
 */

/** Graph caps `$top` well above this; 100 keeps individual responses small. */
const PAGE_SIZE = 100;

/**
 * Richest first. Expanding subtasks and linked resources inline saves two
 * requests per task, but not every tenant has accepted every `$expand`
 * combination over time, so we step down on a 400 rather than fail the load.
 */
const EXPAND_LEVELS: ReadonlyArray<string | undefined> = [
	"checklistItems,linkedResources",
	"checklistItems",
	undefined,
];

export class TodoApi {
	/** Index into `EXPAND_LEVELS` that Graph last accepted. */
	private expandLevel = 0;

	constructor(private readonly client: GraphClient) {}

	/* ---------------------------------------------------------------------- */
	/* Lists                                                                  */
	/* ---------------------------------------------------------------------- */

	/** All task lists the signed-in user can see, in To Do's own order. */
	async getLists(): Promise<TodoTaskList[]> {
		return this.client.getAll<TodoTaskList>("/me/todo/lists", { $top: PAGE_SIZE });
	}

	async createList(displayName: string): Promise<TodoTaskList> {
		return this.client.post<TodoTaskList>("/me/todo/lists", { displayName });
	}

	async renameList(listId: string, displayName: string): Promise<TodoTaskList> {
		return this.client.patch<TodoTaskList>(`/me/todo/lists/${encodeURIComponent(listId)}`, { displayName });
	}

	async deleteList(listId: string): Promise<void> {
		await this.client.delete(`/me/todo/lists/${encodeURIComponent(listId)}`);
	}

	/* ---------------------------------------------------------------------- */
	/* Tasks                                                                  */
	/* ---------------------------------------------------------------------- */

	/**
	 * Tasks in a list, with their subtasks and linked resources where Graph will
	 * expand them.
	 *
	 * `completed` picks which side of the status split to fetch: open tasks only
	 * (the default), completed only, or both. A long-lived list can hold
	 * thousands of completed tasks, so they are only fetched when asked for.
	 */
	async getTasks(listId: string, options: { completed?: "exclude" | "only" | "include" } = {}): Promise<TodoTask[]> {
		const filter =
			options.completed === "include"
				? undefined
				: options.completed === "only"
					? "status eq 'completed'"
					: "status ne 'completed'";

		for (;;) {
			const expand = EXPAND_LEVELS[this.expandLevel];
			try {
				return await this.client.getAll<TodoTask>(`${taskPath(listId)}`, {
					$top: PAGE_SIZE,
					$filter: filter,
					$expand: expand,
				});
			} catch (error) {
				const appError = toAppError(error);
				if (appError.status === 400 && expand !== undefined) {
					this.expandLevel++;
					continue;
				}
				throw appError;
			}
		}
	}

	async getTask(listId: string, taskId: string): Promise<TodoTask> {
		return this.client.get<TodoTask>(taskPath(listId, taskId), {
			$expand: EXPAND_LEVELS[this.expandLevel],
		});
	}

	async createTask(listId: string, input: CreateTaskInput): Promise<TodoTask> {
		const payload: Record<string, unknown> = { title: input.title };

		if (input.body) {
			payload.body = { content: input.body, contentType: "text" };
		}
		if (input.dueDate) {
			payload.dueDateTime = toGraphDate(input.dueDate);
		}
		if (input.importance) {
			payload.importance = input.importance;
		}
		if (input.categories && input.categories.length > 0) {
			payload.categories = input.categories;
		}

		const created = await this.client.post<TodoTask>(taskPath(listId), payload);
		return { ...created, checklistItems: created.checklistItems ?? [], linkedResources: created.linkedResources ?? [] };
	}

	async updateTask(listId: string, taskId: string, input: UpdateTaskInput): Promise<TodoTask> {
		const payload: Record<string, unknown> = {};

		if (input.title !== undefined) payload.title = input.title;
		if (input.body !== undefined) payload.body = { content: input.body, contentType: "text" };
		if (input.status !== undefined) payload.status = input.status;
		if (input.importance !== undefined) payload.importance = input.importance;
		if (input.categories !== undefined) payload.categories = input.categories;
		// `null` is meaningful here - it clears the due date - so test for
		// `undefined` rather than falsiness.
		if (input.dueDate !== undefined) {
			payload.dueDateTime = input.dueDate === null ? null : toGraphDate(input.dueDate);
		}

		return this.client.patch<TodoTask>(taskPath(listId, taskId), payload);
	}

	/**
	 * Completing or reopening a task is just a status change; Graph maintains
	 * `completedDateTime` itself, and rolls recurring tasks forward on its own.
	 */
	async setCompleted(listId: string, taskId: string, completed: boolean): Promise<TodoTask> {
		return this.updateTask(listId, taskId, { status: completed ? "completed" : "notStarted" });
	}

	async deleteTask(listId: string, taskId: string): Promise<void> {
		await this.client.delete(taskPath(listId, taskId));
	}

	/**
	 * Graph has no "move task" operation, so a move is a copy into the target
	 * list followed by a delete of the original. Subtasks and linked resources
	 * are copied across too; the original is only deleted once the copy exists.
	 */
	async moveTask(task: TodoTask, fromListId: string, toListId: string): Promise<TodoTask> {
		const payload: Record<string, unknown> = {
			title: task.title,
			importance: task.importance,
			status: task.status,
			isReminderOn: task.isReminderOn,
		};
		if (task.body?.content) payload.body = task.body;
		if (task.dueDateTime) payload.dueDateTime = task.dueDateTime;
		if (task.reminderDateTime) payload.reminderDateTime = task.reminderDateTime;
		if (task.startDateTime) payload.startDateTime = task.startDateTime;
		if (task.categories?.length) payload.categories = task.categories;
		if (task.recurrence) payload.recurrence = task.recurrence;

		const created = await this.client.post<TodoTask>(taskPath(toListId), payload);

		const checklistItems: ChecklistItem[] = [];
		for (const item of task.checklistItems ?? []) {
			checklistItems.push(
				await this.createChecklistItem(toListId, created.id, item.displayName, item.isChecked)
			);
		}

		const linkedResources: LinkedResource[] = [];
		for (const resource of task.linkedResources ?? []) {
			if (!resource.webUrl && !resource.externalId) continue;
			linkedResources.push(
				await this.createLinkedResource(toListId, created.id, {
					webUrl: resource.webUrl ?? "",
					displayName: resource.displayName ?? resource.webUrl ?? "Linked item",
					applicationName: resource.applicationName ?? "Obsidian",
					externalId: resource.externalId ?? undefined,
				})
			);
		}

		await this.deleteTask(fromListId, task.id);
		return { ...created, checklistItems, linkedResources };
	}

	/* ---------------------------------------------------------------------- */
	/* Subtasks (checklist items)                                             */
	/* ---------------------------------------------------------------------- */

	async getChecklistItems(listId: string, taskId: string): Promise<ChecklistItem[]> {
		return this.client.getAll<ChecklistItem>(`${taskPath(listId, taskId)}/checklistItems`);
	}

	async createChecklistItem(
		listId: string,
		taskId: string,
		displayName: string,
		isChecked = false
	): Promise<ChecklistItem> {
		return this.client.post<ChecklistItem>(`${taskPath(listId, taskId)}/checklistItems`, {
			displayName,
			isChecked,
		});
	}

	async updateChecklistItem(
		listId: string,
		taskId: string,
		itemId: string,
		changes: { displayName?: string; isChecked?: boolean }
	): Promise<ChecklistItem> {
		return this.client.patch<ChecklistItem>(
			`${taskPath(listId, taskId)}/checklistItems/${encodeURIComponent(itemId)}`,
			changes
		);
	}

	async deleteChecklistItem(listId: string, taskId: string, itemId: string): Promise<void> {
		await this.client.delete(`${taskPath(listId, taskId)}/checklistItems/${encodeURIComponent(itemId)}`);
	}

	/* ---------------------------------------------------------------------- */
	/* Linked resources                                                       */
	/* ---------------------------------------------------------------------- */

	async getLinkedResources(listId: string, taskId: string): Promise<LinkedResource[]> {
		return this.client.getAll<LinkedResource>(`${taskPath(listId, taskId)}/linkedResources`);
	}

	async createLinkedResource(listId: string, taskId: string, input: LinkedResourceInput): Promise<LinkedResource> {
		const payload: Record<string, unknown> = {
			webUrl: input.webUrl,
			displayName: input.displayName,
			applicationName: input.applicationName,
		};
		if (input.externalId) payload.externalId = input.externalId;
		return this.client.post<LinkedResource>(`${taskPath(listId, taskId)}/linkedResources`, payload);
	}

	async deleteLinkedResource(listId: string, taskId: string, resourceId: string): Promise<void> {
		await this.client.delete(`${taskPath(listId, taskId)}/linkedResources/${encodeURIComponent(resourceId)}`);
	}
}

function taskPath(listId: string, taskId?: string): string {
	const base = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
	return taskId === undefined ? base : `${base}/${encodeURIComponent(taskId)}`;
}
