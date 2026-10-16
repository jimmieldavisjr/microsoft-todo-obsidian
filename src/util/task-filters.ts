import { daysBetween, fromGraphDate, fromGraphInstant, isDueTodayOrEarlier, startOfToday } from "./date";
import type { SmartListId, TaskWithList, TodoTask, TodoTaskList } from "../types/microsoft-todo";

/**
 * Pure task-selection logic shared by the service (for sidebar counts) and the
 * task pane (for what's on screen), so the two can never disagree.
 */

/* -------------------------------------------------------------------------- */
/* Smart lists                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether an *open* To Do task belongs to a smart list. `assigned` is sourced
 * from Planner, not matched, and `flagged` is a real list - both are handled by
 * the caller, which knows where tasks came from.
 *
 * My Day is derived rather than fetched: Microsoft Graph does not expose To Do's
 * My Day list, so "due today or overdue" is the closest faithful equivalent.
 */
export function matchesSmartList(task: TodoTask, list: TodoTaskList | undefined, smartId: SmartListId): boolean {
	switch (smartId) {
		case "all":
			// Flagged email has its own view, and would otherwise drown the rest.
			return list?.wellknownListName !== "flaggedEmails";
		case "myDay": {
			const due = fromGraphDate(task.dueDateTime);
			return due !== null && isDueTodayOrEarlier(due);
		}
		case "important":
			return task.importance === "high";
		case "planned":
			return fromGraphDate(task.dueDateTime) !== null;
		case "flagged":
			return list?.wellknownListName === "flaggedEmails";
		case "assigned":
			return false;
	}
}

/* -------------------------------------------------------------------------- */
/* Filter tabs                                                                */
/* -------------------------------------------------------------------------- */

export type TaskFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

export const TASK_FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
	{ id: "all", label: "All" },
	{ id: "today", label: "Today" },
	{ id: "upcoming", label: "Upcoming" },
	{ id: "overdue", label: "Overdue" },
	{ id: "completed", label: "Completed" },
];

export function matchesFilter(task: TaskWithList, filter: TaskFilter): boolean {
	const completed = task.status === "completed";
	if (filter === "completed") return completed;
	if (completed) return false;
	if (filter === "all") return true;

	const due = fromGraphDate(task.dueDateTime);
	if (!due) return false;
	const offset = daysBetween(startOfToday(), due);

	switch (filter) {
		case "today":
			return offset === 0;
		case "upcoming":
			return offset > 0;
		case "overdue":
			return offset < 0;
	}
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Case-insensitive match on every whitespace-separated term, across title,
 * notes, tags, list name and subtasks - so "docs obsidian" finds a task titled
 * "Write docs" that lives in the Obsidian list.
 */
export function matchesSearch(task: TaskWithList, query: string): boolean {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;

	const haystack = [
		task.title,
		task.body?.content ?? "",
		task.listName,
		...(task.categories ?? []),
		...(task.checklistItems ?? []).map((item) => item.displayName),
	]
		.join("\n")
		.toLowerCase();

	return terms.every((term) => haystack.includes(term));
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

export type SortField = "dueDate" | "importance" | "title" | "created";
export type SortDirection = "asc" | "desc";

export const SORT_FIELDS: ReadonlyArray<{ id: SortField; label: string; icon: string }> = [
	{ id: "dueDate", label: "Due date", icon: "calendar" },
	{ id: "importance", label: "Importance", icon: "star" },
	{ id: "title", label: "Alphabetically", icon: "arrow-down-a-z" },
	{ id: "created", label: "Creation date", icon: "clock" },
];

export function sortTasks(tasks: TaskWithList[], field: SortField, direction: SortDirection): TaskWithList[] {
	const sign = direction === "asc" ? 1 : -1;
	return [...tasks].sort((a, b) => {
		// Completed tasks sort by when they were completed, newest first,
		// whatever the chosen field - that's the order people look for them in.
		const aDone = a.status === "completed";
		const bDone = b.status === "completed";
		if (aDone !== bDone) return aDone ? 1 : -1;
		if (aDone && bDone) return completedAt(b) - completedAt(a);

		const primary = compareBy(a, b, field) * sign;
		return primary !== 0 ? primary : compareDefault(a, b);
	});
}

function compareBy(a: TaskWithList, b: TaskWithList, field: SortField): number {
	switch (field) {
		case "dueDate": {
			const aDue = fromGraphDate(a.dueDateTime)?.getTime();
			const bDue = fromGraphDate(b.dueDateTime)?.getTime();
			// Undated tasks always trail dated ones, in either direction.
			if (aDue === undefined && bDue === undefined) return 0;
			if (aDue === undefined) return 1;
			if (bDue === undefined) return -1;
			return aDue - bDue;
		}
		case "importance":
			return importanceRank(a) - importanceRank(b);
		case "title":
			return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
		case "created":
			return Date.parse(a.createdDateTime) - Date.parse(b.createdDateTime);
	}
}

/** Due date, then importance, then creation order - the tie-breaker for every field. */
function compareDefault(a: TaskWithList, b: TaskWithList): number {
	return compareBy(a, b, "dueDate") || compareBy(a, b, "importance") || compareBy(a, b, "created");
}

function importanceRank(task: TodoTask): number {
	return task.importance === "high" ? 0 : task.importance === "normal" ? 1 : 2;
}

function completedAt(task: TodoTask): number {
	return fromGraphInstant(task.completedDateTime)?.getTime() ?? 0;
}
