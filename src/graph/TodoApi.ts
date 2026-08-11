import type { GraphClient } from "./GraphClient";
import { toGraphDate } from "../util/date";
import type {
	CreateTaskInput,
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

export class TodoApi {
	constructor(private readonly client: GraphClient) {}

	/** All task lists the signed-in user can see, in To Do's own order. */
	async getLists(): Promise<TodoTaskList[]> {
		return this.client.getAll<TodoTaskList>("/me/todo/lists", { $top: PAGE_SIZE });
	}

	/**
	 * Tasks in a list. Completed tasks are excluded server-side unless asked for -
	 * a long-lived list can hold thousands of them.
	 */
	async getTasks(listId: string, options: { includeCompleted?: boolean } = {}): Promise<TodoTask[]> {
		return this.client.getAll<TodoTask>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, {
			$top: PAGE_SIZE,
			$filter: options.includeCompleted ? undefined : "status ne 'completed'",
		});
	}

	async getTask(listId: string, taskId: string): Promise<TodoTask> {
		return this.client.get<TodoTask>(
			`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`
		);
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

		return this.client.post<TodoTask>(`/me/todo/lists/${encodeURIComponent(listId)}/tasks`, payload);
	}

	async updateTask(listId: string, taskId: string, input: UpdateTaskInput): Promise<TodoTask> {
		const payload: Record<string, unknown> = {};

		if (input.title !== undefined) payload.title = input.title;
		if (input.body !== undefined) payload.body = { content: input.body, contentType: "text" };
		if (input.status !== undefined) payload.status = input.status;
		if (input.importance !== undefined) payload.importance = input.importance;
		// `null` is meaningful here - it clears the due date - so test for
		// `undefined` rather than falsiness.
		if (input.dueDate !== undefined) {
			payload.dueDateTime = input.dueDate === null ? null : toGraphDate(input.dueDate);
		}

		return this.client.patch<TodoTask>(
			`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
			payload
		);
	}

	/**
	 * Completing or reopening a task is just a status change; Graph maintains
	 * `completedDateTime` itself, and rolls recurring tasks forward on its own.
	 */
	async setCompleted(listId: string, taskId: string, completed: boolean): Promise<TodoTask> {
		return this.updateTask(listId, taskId, { status: completed ? "completed" : "notStarted" });
	}

	async deleteTask(listId: string, taskId: string): Promise<void> {
		await this.client.delete(
			`/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`
		);
	}
}
