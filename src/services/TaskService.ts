import type { AccountInfo, MicrosoftAuth } from "../auth/MicrosoftAuth";
import type { TodoApi } from "../graph/TodoApi";
import type { MicrosoftTodoSettings } from "../settings/MicrosoftTodoSettings";
import { AppError, toAppError } from "../errors";
import { mapLimitSettled } from "../util/async";
import { fromGraphDate, fromGraphInstant, isDueTodayOrEarlier } from "../util/date";
import {
	selectionKey,
	selectionsEqual,
	type CreateTaskInput,
	type ListSelection,
	type TaskWithList,
	type TodoTask,
	type TodoTaskList,
	type UpdateTaskInput,
} from "../types/microsoft-todo";

/**
 * The application service: everything the UI needs, with no UI in it.
 *
 * Holds one cache of tasks keyed by list, derives the current view (including
 * the two client-side smart views) from that cache, and exposes an observable
 * snapshot the React tree subscribes to.
 */

/** Lists are fetched in parallel; Graph throttles aggressively above this. */
const LIST_FETCH_CONCURRENCY = 4;

/** A refresh younger than this is reused instead of refetching. */
const STALE_AFTER_MS = 60_000;

export type LoadStatus = "idle" | "loading" | "refreshing";

export interface TodoState {
	configured: boolean;
	signedIn: boolean;
	account: AccountInfo | null;

	lists: TodoTaskList[];
	selection: ListSelection;

	/** Tasks for the current selection, already sorted for display. */
	tasks: TaskWithList[];
	/** Open-task counts, keyed by `selectionKey` - `list:<id>` or `smart:<id>`. */
	counts: Record<string, number>;

	status: LoadStatus;
	error: AppError | null;
	/** Tasks with a mutation in flight, so rows can show a pending state. */
	busyTaskIds: string[];
	lastSyncAt: number | null;
}

export interface RefreshOptions {
	/** Refresh even if the cache is still fresh. */
	force?: boolean;
	/** Keep the previous data on screen instead of showing a full-panel spinner. */
	background?: boolean;
}

type Listener = () => void;

const DEFAULT_SELECTION: ListSelection = { kind: "smart", id: "myDay" };

export class TaskService {
	private state: TodoState;
	private snapshot: TodoState;
	private readonly listeners = new Set<Listener>();

	/** listId -> tasks. Holds completed tasks too when they have been fetched. */
	private readonly cache = new Map<string, TodoTask[]>();
	private readonly loadedListIds = new Set<string>();

	private inFlight: Promise<void> | null = null;
	private disposeAuthListener: (() => void) | null = null;

	constructor(
		private readonly auth: MicrosoftAuth,
		private readonly api: TodoApi,
		private readonly getSettings: () => MicrosoftTodoSettings,
		private readonly persistSelection: (selection: ListSelection) => void
	) {
		this.state = {
			configured: false,
			signedIn: false,
			account: null,
			lists: [],
			selection: DEFAULT_SELECTION,
			tasks: [],
			counts: {},
			status: "idle",
			error: null,
			busyTaskIds: [],
			lastSyncAt: null,
		};
		this.snapshot = this.state;
	}

	/* ---------------------------------------------------------------------- */
	/* Lifecycle                                                              */
	/* ---------------------------------------------------------------------- */

	start(): void {
		this.disposeAuthListener = this.auth.onChange(() => {
			const signedIn = this.auth.isSignedIn;
			if (!signedIn) this.clearCache();
			this.patch({
				signedIn,
				configured: this.auth.isConfigured,
				account: this.auth.account,
				...(signedIn ? {} : { lists: [], tasks: [], counts: {}, lastSyncAt: null }),
			});
		});

		this.patch({
			configured: this.auth.isConfigured,
			signedIn: this.auth.isSignedIn,
			account: this.auth.account,
			selection: this.resolveInitialSelection(),
		});
	}

	dispose(): void {
		this.disposeAuthListener?.();
		this.disposeAuthListener = null;
		this.listeners.clear();
	}

	/* ---------------------------------------------------------------------- */
	/* Observable state                                                       */
	/* ---------------------------------------------------------------------- */

	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Returns a stable object identity between changes - `useSyncExternalStore`
	 * would loop forever if this allocated on every call.
	 */
	getState = (): TodoState => this.snapshot;

	private patch(changes: Partial<TodoState>): void {
		this.state = { ...this.state, ...changes };
		this.snapshot = this.state;
		for (const listener of this.listeners) listener();
	}

	/**
	 * Recomputes everything derived from the cache, then notifies.
	 *
	 * `extra` is applied on top, and a selection passed in it is honoured *before*
	 * derivation - otherwise switching lists would render the previous list's
	 * tasks under the new heading.
	 */
	private recompute(extra: Partial<TodoState> = {}): void {
		const selection = extra.selection ?? this.state.selection;
		this.patch({
			tasks: this.deriveTasks(selection),
			counts: this.deriveCounts(),
			...extra,
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Selection                                                              */
	/* ---------------------------------------------------------------------- */

	private resolveInitialSelection(): ListSelection {
		const settings = this.getSettings();
		switch (settings.defaultView) {
			case "myDay":
				return { kind: "smart", id: "myDay" };
			case "important":
				return { kind: "smart", id: "important" };
			case "defaultList":
				return settings.defaultListId
					? { kind: "list", id: settings.defaultListId }
					: { kind: "smart", id: "myDay" };
			case "last":
			default:
				return settings.lastSelection ?? DEFAULT_SELECTION;
		}
	}

	async select(selection: ListSelection): Promise<void> {
		if (selectionsEqual(selection, this.state.selection)) return;

		this.persistSelection(selection);
		this.recompute({ selection, error: null });

		// A smart view needs every list; a list we've never opened needs fetching.
		const needsFetch =
			this.state.lists.length === 0 ||
			(selection.kind === "smart"
				? this.lists().some((list) => !this.loadedListIds.has(list.id))
				: !this.loadedListIds.has(selection.id));

		if (needsFetch && this.auth.isSignedIn) {
			await this.refresh({ force: true, background: this.state.tasks.length > 0 });
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Refresh                                                                */
	/* ---------------------------------------------------------------------- */

	/**
	 * Loads lists and tasks. Concurrent callers share one in-flight refresh so
	 * that (say) opening the view while auto-refresh fires doesn't double-fetch.
	 */
	async refresh(options: RefreshOptions = {}): Promise<void> {
		if (!this.auth.isConfigured) {
			this.patch({ configured: false });
			return;
		}
		if (!this.auth.isSignedIn) return;

		if (this.inFlight) return this.inFlight;

		const fresh =
			!options.force &&
			this.state.lastSyncAt !== null &&
			Date.now() - this.state.lastSyncAt < STALE_AFTER_MS;
		if (fresh) return;

		const showSpinner = !options.background && this.state.tasks.length === 0;
		this.patch({ status: showSpinner ? "loading" : "refreshing", error: null });

		this.inFlight = this.runRefresh().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	private async runRefresh(): Promise<void> {
		try {
			const lists = await this.api.getLists();

			// Forget cache for lists that no longer exist.
			const liveIds = new Set(lists.map((list) => list.id));
			for (const id of [...this.cache.keys()]) {
				if (!liveIds.has(id)) {
					this.cache.delete(id);
					this.loadedListIds.delete(id);
				}
			}

			this.patch({ lists });

			const targets = this.listsToFetch(lists);
			const includeCompleted = this.getSettings().showCompleted;

			const results = await mapLimitSettled(targets, LIST_FETCH_CONCURRENCY, async (list) => {
				const tasks = await this.api.getTasks(list.id, { includeCompleted });
				return { listId: list.id, tasks };
			});

			const failures: unknown[] = [];
			for (const result of results) {
				if (result.ok) {
					this.cache.set(result.value.listId, result.value.tasks);
					this.loadedListIds.add(result.value.listId);
				} else {
					failures.push(result.error);
				}
			}

			// One flaky list shouldn't blank the panel; total failure should surface.
			if (failures.length > 0 && failures.length === targets.length) {
				throw toAppError(failures[0]);
			}

			this.recompute({
				status: "idle",
				error: failures.length > 0 ? toAppError(failures[0]) : null,
				lastSyncAt: Date.now(),
			});
		} catch (error) {
			const appError = toAppError(error);
			this.recompute({ status: "idle", error: appError });
			if (appError.requiresSignIn) this.clearCache();
		}
	}

	/**
	 * Which lists this refresh needs to touch. Smart views and sidebar counts
	 * both need everything; otherwise the selected list alone is enough.
	 */
	private listsToFetch(lists: TodoTaskList[]): TodoTaskList[] {
		const settings = this.getSettings();
		const selection = this.state.selection;

		if (settings.showListCounts || selection.kind === "smart") return lists;

		const selected = lists.find((list) => list.id === selection.id);
		return selected ? [selected] : lists.slice(0, 1);
	}

	async setShowCompleted(_value: boolean): Promise<void> {
		// The cache no longer matches what we'd fetch, so pull everything again.
		await this.refresh({ force: true, background: true });
	}

	notifySettingsChanged(): void {
		this.patch({ configured: this.auth.isConfigured });
	}

	private clearCache(): void {
		this.cache.clear();
		this.loadedListIds.clear();
	}

	/* ---------------------------------------------------------------------- */
	/* Derivation                                                             */
	/* ---------------------------------------------------------------------- */

	private lists(): TodoTaskList[] {
		return this.state.lists;
	}

	private withList(task: TodoTask, list: TodoTaskList): TaskWithList {
		return { ...task, listId: list.id, listName: list.displayName };
	}

	private deriveTasks(selection: ListSelection): TaskWithList[] {
		const lists = this.lists();

		if (selection.kind === "list") {
			const list = lists.find((candidate) => candidate.id === selection.id);
			if (!list) return [];
			const tasks = this.cache.get(list.id) ?? [];
			return tasks.map((task) => this.withList(task, list)).sort(compareTasks);
		}

		const matches: TaskWithList[] = [];
		for (const list of lists) {
			for (const task of this.cache.get(list.id) ?? []) {
				if (matchesSmartList(task, selection.id)) matches.push(this.withList(task, list));
			}
		}
		return matches.sort(compareTasks);
	}

	private deriveCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		let myDay = 0;
		let important = 0;

		for (const list of this.lists()) {
			const tasks = this.cache.get(list.id);
			// Lists we haven't fetched stay absent rather than reporting a false zero.
			if (!tasks) continue;

			let open = 0;
			for (const task of tasks) {
				if (task.status === "completed") continue;
				open++;
				if (matchesSmartList(task, "myDay")) myDay++;
				if (matchesSmartList(task, "important")) important++;
			}
			counts[selectionKey({ kind: "list", id: list.id })] = open;
		}

		counts[selectionKey({ kind: "smart", id: "myDay" })] = myDay;
		counts[selectionKey({ kind: "smart", id: "important" })] = important;
		return counts;
	}

	/* ---------------------------------------------------------------------- */
	/* Mutations                                                              */
	/* ---------------------------------------------------------------------- */

	/**
	 * The list a new task should land in when the caller didn't name one:
	 * the configured default, else the currently selected list, else To Do's own
	 * default list, else the first list there is.
	 */
	resolveTargetListId(preferred?: string): string | null {
		const lists = this.lists();
		const exists = (id: string | undefined | null): id is string =>
			!!id && lists.some((list) => list.id === id);

		if (exists(preferred)) return preferred;

		const settings = this.getSettings();
		if (exists(settings.defaultListId)) return settings.defaultListId;

		const selection = this.state.selection;
		if (selection.kind === "list" && exists(selection.id)) return selection.id;

		const wellKnown = lists.find((list) => list.wellknownListName === "defaultList");
		if (wellKnown) return wellKnown.id;

		return lists[0]?.id ?? null;
	}

	async createTask(listId: string, input: CreateTaskInput): Promise<TodoTask> {
		const created = await this.api.createTask(listId, input);

		const tasks = this.cache.get(listId);
		if (tasks) {
			this.cache.set(listId, [created, ...tasks]);
		} else {
			this.cache.set(listId, [created]);
			this.loadedListIds.add(listId);
		}
		this.recompute();

		return created;
	}

	async updateTask(task: TaskWithList, input: UpdateTaskInput): Promise<void> {
		await this.mutate(task, applyLocally(task, input), () =>
			this.api.updateTask(task.listId, task.id, input)
		);
	}

	async renameTask(task: TaskWithList, title: string): Promise<void> {
		const trimmed = title.trim();
		if (!trimmed || trimmed === task.title) return;
		await this.updateTask(task, { title: trimmed });
	}

	async setCompleted(task: TaskWithList, completed: boolean): Promise<void> {
		const optimistic: TodoTask = {
			...task,
			status: completed ? "completed" : "notStarted",
			completedDateTime: completed
				? { dateTime: new Date().toISOString().replace("Z", "0000000"), timeZone: "UTC" }
				: null,
		};
		await this.mutate(task, optimistic, () => this.api.setCompleted(task.listId, task.id, completed));
	}

	async deleteTask(task: TaskWithList): Promise<void> {
		const previous = this.cache.get(task.listId);
		if (!previous) return;

		this.cache.set(
			task.listId,
			previous.filter((candidate) => candidate.id !== task.id)
		);
		this.recompute();

		try {
			await this.api.deleteTask(task.listId, task.id);
		} catch (error) {
			const appError = toAppError(error);
			// A task deleted elsewhere is already in the state we wanted.
			if (appError.kind !== "not-found") {
				this.cache.set(task.listId, previous);
				this.recompute();
			}
			throw appError;
		}
	}

	/**
	 * Applies `optimistic` to the cache immediately, runs `request`, then swaps in
	 * the authoritative server copy. Rolls the cache back if the request fails.
	 */
	private async mutate(
		task: TaskWithList,
		optimistic: TodoTask,
		request: () => Promise<TodoTask>
	): Promise<void> {
		const previous = this.cache.get(task.listId);
		if (!previous) return;

		const index = previous.findIndex((candidate) => candidate.id === task.id);
		if (index === -1) return;

		const next = [...previous];
		next[index] = optimistic;
		this.cache.set(task.listId, next);
		this.setBusy(task.id, true);
		this.recompute();

		try {
			const updated = await request();
			const current = this.cache.get(task.listId);
			if (current) {
				const position = current.findIndex((candidate) => candidate.id === task.id);
				if (position !== -1) {
					const merged = [...current];
					merged[position] = updated;
					this.cache.set(task.listId, merged);
				}
			}
			this.setBusy(task.id, false);
			this.recompute({ error: null });
		} catch (error) {
			this.cache.set(task.listId, previous);
			this.setBusy(task.id, false);
			// Left to the caller to report: the panel-wide error banner is for
			// failures to *load*, and offers a retry that makes no sense here.
			this.recompute();
			throw toAppError(error);
		}
	}

	private setBusy(taskId: string, busy: boolean): void {
		const current = new Set(this.state.busyTaskIds);
		if (busy) current.add(taskId);
		else current.delete(taskId);
		this.state = { ...this.state, busyTaskIds: [...current] };
		this.snapshot = this.state;
	}

	clearError(): void {
		if (this.state.error) this.patch({ error: null });
	}
}

/* -------------------------------------------------------------------------- */
/* Pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * My Day is derived rather than fetched: Microsoft Graph does not expose To Do's
 * My Day list, so "due today or overdue" is the closest faithful equivalent.
 */
function matchesSmartList(task: TodoTask, smartId: "myDay" | "important"): boolean {
	if (task.status === "completed") return false;

	if (smartId === "important") return task.importance === "high";

	const due = fromGraphDate(task.dueDateTime);
	return due !== null && isDueTodayOrEarlier(due);
}

/** Open tasks first, then by due date, importance, and finally creation order. */
function compareTasks(a: TaskWithList, b: TaskWithList): number {
	const aDone = a.status === "completed";
	const bDone = b.status === "completed";
	if (aDone !== bDone) return aDone ? 1 : -1;

	if (aDone) {
		// Most recently completed at the top of the completed group.
		const aAt = fromGraphInstant(a.completedDateTime)?.getTime() ?? 0;
		const bAt = fromGraphInstant(b.completedDateTime)?.getTime() ?? 0;
		return bAt - aAt;
	}

	const aDue = fromGraphDate(a.dueDateTime)?.getTime();
	const bDue = fromGraphDate(b.dueDateTime)?.getTime();
	if (aDue !== undefined && bDue !== undefined && aDue !== bDue) return aDue - bDue;
	if (aDue !== undefined && bDue === undefined) return -1;
	if (aDue === undefined && bDue !== undefined) return 1;

	const aImportant = a.importance === "high" ? 0 : 1;
	const bImportant = b.importance === "high" ? 0 : 1;
	if (aImportant !== bImportant) return aImportant - bImportant;

	return Date.parse(a.createdDateTime) - Date.parse(b.createdDateTime);
}

/** Mirrors an update onto a cached task so the UI can show it before the round trip. */
function applyLocally(task: TodoTask, input: UpdateTaskInput): TodoTask {
	const next: TodoTask = { ...task };

	if (input.title !== undefined) next.title = input.title;
	if (input.status !== undefined) next.status = input.status;
	if (input.importance !== undefined) next.importance = input.importance;
	if (input.body !== undefined) next.body = { content: input.body, contentType: "text" };
	if (input.dueDate !== undefined) {
		next.dueDateTime =
			input.dueDate === null
				? null
				: {
						dateTime: `${input.dueDate.getFullYear()}-${pad(input.dueDate.getMonth() + 1)}-${pad(
							input.dueDate.getDate()
						)}T00:00:00.0000000`,
						timeZone: "UTC",
					};
	}

	return next;
}

function pad(value: number): string {
	return String(value).padStart(2, "0");
}
