import type { DateTimeTimeZone } from "../types/microsoft-todo";

/**
 * Due dates in Microsoft To Do are conceptually *dates*, not instants - a task
 * due "11 August" is due on the 11th wherever you happen to be. Graph still
 * wraps them in a `DateTimeTimeZone`, which is where almost every off-by-one-day
 * bug in To Do clients comes from.
 *
 * We sidestep it: write midnight UTC, and read back only the `YYYY-MM-DD`
 * portion without ever letting the local timezone shift it.
 */

/** Serialises a calendar date the way To Do expects it. */
export function toGraphDate(date: Date): DateTimeTimeZone {
	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	return {
		dateTime: `${year}-${month}-${day}T00:00:00.0000000`,
		timeZone: "UTC",
	};
}

/** Reads a Graph date envelope as a local calendar date at midnight. */
export function fromGraphDate(value: DateTimeTimeZone | null | undefined): Date | null {
	if (!value?.dateTime) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.dateTime);
	if (!match) return null;
	const [, year, month, day] = match;
	return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Reads a Graph date envelope as a real instant (for completion timestamps). */
export function fromGraphInstant(value: DateTimeTimeZone | null | undefined): Date | null {
	if (!value?.dateTime) return null;
	// Graph omits the trailing `Z` even when the zone is UTC.
	const iso = value.dateTime.endsWith("Z") ? value.dateTime : `${value.dateTime}Z`;
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfToday(): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, days: number): Date {
	const next = new Date(date);
	next.setDate(next.getDate() + days);
	return next;
}

/**
 * The Monday of next week - what Microsoft To Do's "Next week" due-date option
 * means. Always lands 1-7 days ahead, never today.
 */
export function nextMonday(): Date {
	const today = startOfToday();
	const offset = (8 - today.getDay()) % 7 || 7;
	return addDays(today, offset);
}

/** Whole-day difference between two calendar dates (b - a). */
export function daysBetween(a: Date, b: Date): number {
	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	const left = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
	const right = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
	return Math.round((right - left) / MS_PER_DAY);
}

export function isToday(date: Date): boolean {
	return daysBetween(startOfToday(), date) === 0;
}

export function isOverdue(date: Date): boolean {
	return daysBetween(startOfToday(), date) < 0;
}

/** Due today or earlier - the rule behind the derived My Day view. */
export function isDueTodayOrEarlier(date: Date): boolean {
	return daysBetween(startOfToday(), date) <= 0;
}

/** "Today", "Tomorrow", "Mon, 18 Aug", "12 Mar 2025". */
export function formatDueDate(date: Date): string {
	const offset = daysBetween(startOfToday(), date);

	if (offset === 0) return "Today";
	if (offset === 1) return "Tomorrow";
	if (offset === -1) return "Yesterday";

	const sameYear = date.getFullYear() === new Date().getFullYear();

	if (offset > 1 && offset < 7) {
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}

	return date.toLocaleDateString(undefined, {
		weekday: offset > -7 && offset < 7 ? "short" : undefined,
		day: "numeric",
		month: "short",
		year: sameYear ? undefined : "numeric",
	});
}

/** Parses the `YYYY-MM-DD` value produced by an `<input type="date">`. */
export function parseDateInput(value: string): Date | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const [, year, month, day] = match;
	const date = new Date(Number(year), Number(month) - 1, Number(day));
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a date for an `<input type="date">` value. */
export function toDateInputValue(date: Date | null | undefined): string {
	if (!date) return "";
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}
