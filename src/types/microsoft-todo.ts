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
	/** Present when fetched with `$expand=checklistItems`. */
	checklistItems?: ChecklistItem[];
	/** Present when fetched with `$expand=linkedResources`. */
	linkedResources?: LinkedResource[];
}

/** A subtask ("step" in To Do's own UI). */
export interface ChecklistItem {
	id: string;
	displayName: string;
	isChecked: boolean;
	createdDateTime?: string;
	checkedDateTime?: string | null;
}

/**
 * A pointer from a task to something in another app. The plugin writes one per
 * linked Obsidian note, with an `obsidian://` URI as its `webUrl`.
 */
export interface LinkedResource {
	id: string;
	webUrl?: string | null;
	applicationName?: string | null;
	displayName?: string | null;
	externalId?: string | null;
}

/**
 * The subset of a Planner task the "Assigned to me" view reads. Microsoft To Do
 * builds its own "Assigned to me" list from Planner; Graph exposes no To Do
 * equivalent.
 */
export interface PlannerTask {
	id: string;
	planId: string;
	bucketId?: string | null;
	title: string;
	percentComplete: number;
	priority?: number;
	createdDateTime: string;
	/** Plain ISO instant, unlike To Do's `DateTimeTimeZone`. */
	dueDateTime?: string | null;
	completedDateTime?: string | null;
	hasDescription?: boolean;
	checklistItemCount?: number;
	activeChecklistItemCount?: number;
}

export interface PlannerPlan {
	id: string;
	title: string;
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
	/**
	 * Where the task came from. Planner tasks surface in "Assigned to me" only,
	 * and are read-only here - Planner writes need ETags and a different shape.
	 */
	source: "todo" | "planner";
}

/**
 * Smart views are computed client-side.
 *
 * Microsoft Graph does not expose My Day (or any of To Do's other "smart" lists)
 * as a `todoTaskList`, so we derive an equivalent from the tasks we can read.
 * `myDay` keeps its original id so saved selections and settings survive; it is
 * labelled "Today" to match what it contains.
 */
export type SmartListId = "all" | "myDay" | "important" | "planned" | "assigned" | "flagged";

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
		id: "all",
		label: "My Tasks",
		icon: "user",
		description: "Every open task, across every list.",
	},
	{
		id: "myDay",
		label: "Today",
		icon: "alarm-clock",
		description: "Tasks due today or overdue, across every list.",
	},
	{
		id: "important",
		label: "Important",
		icon: "star",
		description: "Tasks marked high importance, across every list.",
	},
	{
		id: "planned",
		label: "Planned",
		icon: "calendar-days",
		description: "Tasks with a due date, across every list.",
	},
	{
		id: "assigned",
		label: "Assigned to me",
		icon: "user-check",
		description: "Planner tasks assigned to you. Work and school accounts only.",
	},
	{
		id: "flagged",
		label: "Flagged",
		icon: "flag",
		description: "Emails you flagged in Outlook.",
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
	categories?: string[];
}

/** Fields the plugin can send when updating a task. */
export interface UpdateTaskInput {
	title?: string;
	body?: string;
	status?: TaskStatus;
	importance?: Importance;
	/** `null` clears the due date; `undefined` leaves it untouched. */
	dueDate?: Date | null;
	categories?: string[];
}

/** Fields for creating or linking an Obsidian note to a task. */
export interface LinkedResourceInput {
	webUrl: string;
	displayName: string;
	applicationName: string;
	externalId?: string;
}
