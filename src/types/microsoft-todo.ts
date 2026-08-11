/**
 * Microsoft Graph To Do resource shapes (v1.0) plus the view-model types the
 * plugin layers on top of them.
 *
 * Graph reference: https://learn.microsoft.com/graph/api/resources/todo-overview
 */

/* -------------------------------------------------------------------------- */
/* Graph resources                                                            */
/* -------------------------------------------------------------------------- */

export type TaskStatus =
	| "notStarted"
	| "inProgress"
	| "completed"
	| "waitingOnOthers"
	| "deferred";

export type Importance = "low" | "normal" | "high";

export type WellKnownListName = "none" | "defaultList" | "flaggedEmails" | "unknownFutureValue";

/** Graph's date envelope. `dateTime` has no trailing `Z`, e.g. `2026-08-11T00:00:00.0000000`. */
export interface DateTimeTimeZone {
	dateTime: string;
	timeZone: string;
}

export interface ItemBody {
	content: string;
	contentType: "text" | "html";
}

export interface TodoTaskList {
	id: string;
	displayName: string;
	isOwner: boolean;
	isShared: boolean;
	wellknownListName: WellKnownListName;
}

export interface TodoTask {
	id: string;
	title: string;
	status: TaskStatus;
	importance: Importance;
	isReminderOn: boolean;
	createdDateTime: string;
	lastModifiedDateTime: string;
	body?: ItemBody;
	bodyLastModifiedDateTime?: string;
	completedDateTime?: DateTimeTimeZone | null;
	dueDateTime?: DateTimeTimeZone | null;
	reminderDateTime?: DateTimeTimeZone | null;
	startDateTime?: DateTimeTimeZone | null;
	categories?: string[];
	hasAttachments?: boolean;
	recurrence?: unknown;
}

/** Envelope returned by Graph collection endpoints. */
export interface GraphCollection<T> {
	value: T[];
	"@odata.nextLink"?: string;
	"@odata.count"?: number;
}

/** Error envelope returned by Graph on failure. */
export interface GraphErrorBody {
	error?: {
		code?: string;
		message?: string;
		innerError?: Record<string, unknown>;
	};
}

/* -------------------------------------------------------------------------- */
/* Plugin view models                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A task together with the list it lives in. Smart views aggregate tasks across
 * lists, so a bare `TodoTask` is never enough to route a mutation back to Graph.
 */
export interface TaskWithList extends TodoTask {
	listId: string;
	listName: string;
}

/**
 * Smart views are computed client-side.
 *
 * Microsoft Graph does not expose My Day (or any of To Do's other "smart" lists)
 * as a `todoTaskList`, so we derive an equivalent from the tasks we can read.
 */
export type SmartListId = "myDay" | "important";

export type ListSelection =
	| { kind: "list"; id: string }
	| { kind: "smart"; id: SmartListId };

export const SMART_LISTS: ReadonlyArray<{
	id: SmartListId;
	label: string;
	icon: string;
	description: string;
}> = [
	{
		id: "myDay",
		label: "My Day",
		icon: "sun",
		description: "Tasks due today or overdue, across every list.",
	},
	{
		id: "important",
		label: "Important",
		icon: "star",
		description: "Tasks marked high importance, across every list.",
	},
];

export function selectionKey(selection: ListSelection): string {
	return selection.kind === "smart" ? `smart:${selection.id}` : `list:${selection.id}`;
}

export function selectionsEqual(a: ListSelection, b: ListSelection): boolean {
	return a.kind === b.kind && a.id === b.id;
}

/** Fields the plugin can send when creating a task. */
export interface CreateTaskInput {
	title: string;
	body?: string;
	dueDate?: Date | null;
	importance?: Importance;
}

/** Fields the plugin can send when updating a task. */
export interface UpdateTaskInput {
	title?: string;
	body?: string;
	status?: TaskStatus;
	importance?: Importance;
	/** `null` clears the due date; `undefined` leaves it untouched. */
	dueDate?: Date | null;
}
