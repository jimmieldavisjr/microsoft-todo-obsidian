import type { AccountInfo, MicrosoftAuth } from "../auth/MicrosoftAuth";
import type { TodoApi } from "../graph/TodoApi";
import type { PlannerApi } from "../graph/PlannerApi";
import type { MicrosoftTodoSettings } from "../settings/MicrosoftTodoSettings";
import { AppError, toAppError } from "../errors";
import { mapLimitSettled } from "../util/async";
import { toGraphDate } from "../util/date";
import { matchesSmartList, sortTasks } from "../util/task-filters";
import {
	SMART_LISTS,
	selectionKey,
	selectionsEqual,
	type ChecklistItem,
	type CreateTaskInput,
	type Importance,
	type LinkedResource,
	type LinkedResourceInput,
	type ListSelection,
	type PlannerTask,
	type TaskStatus,
	type TaskWithList,
	type TodoTask,
	type TodoTaskList,
	type UpdateTaskInput,
} from "../types/microsoft-todo";

/**
 * The application service: everything the UI needs, with no UI in it.
 *
 * Holds one cache of tasks keyed by list, derives the current view (including
 * the client-side smart views) from that cache, and exposes an observable
 * snapshot the React tree subscribes to.
 */

/** Lists are fetched in parallel; Graph throttles aggressively above this. */
const LIST_FETCH_CONCURRENCY = 4;

/** A refresh younger than this is reused instead of refetching. */
const STALE_AFTER_MS = 60_000;

/** Planner tasks live in their own pseudo-lists so they can't collide with To Do IDs. */
const PLANNER_LIST_PREFIX = "planner:";

export type LoadStatus = "idle" | "loading" | "refreshing";

export interface TodoState {
	configured: boolean;
	signedIn: boolean;
	account: AccountInfo | null;

	lists: TodoTaskList[];
	selection: ListSelection;

	/** Tasks for the current selection, open and completed, in default order. */
	tasks: TaskWithList[];
	/** Every task the plugin has cached, across all lists - search spans these. */
	allTasks: TaskWithList[];
	/** Open-task counts, keyed by `selectionKey` - `list:<id>` or `smart:<id>`. */
	counts: Record<string, number>;

	/** `null` until the first Planner request settles; `false` for personal accounts. */
	plannerAvailable: boolean | null;
	/** True once completed tasks have been fetched for every list. */
	completedLoaded: boolean;
	completedLoading: boolean;

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

const DEFAULT_SELECTION: ListSelection = { kind: "smart", id: "all" };

export class TaskService {
	private state: TodoState;
	private snapshot: TodoState;
	private readonly listeners = new Set<Listener>();

	/** listId -> tasks. Holds completed tasks too when they have been fetched. */
	private readonly cache = new Map<string, TodoTask[]>();
	private readonly loadedListIds = new Set<string>();
	/** Lists whose completed tasks are in the cache, so refreshes keep them. */
	private readonly completedListIds = new Set<string>();
	private plannerTasks: TaskWithList[] = [];

	private inFlight: Promise<void> | null = null;
	private disposeAuthListener: (() => void) | null = null;

	constructor(
		private readonly auth: MicrosoftAuth,
		private readonly api: TodoApi,
		private readonly planner: PlannerApi,
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
			allTasks: [],
			counts: {},
			plannerAvailable: null,
			completedLoaded: false,
			completedLoading: false,
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
				...(signedIn
					? {}
					: {
							lists: [],
							tasks: [],
							allTasks: [],
							counts: {},
							lastSyncAt: null,
							plannerAvailable: null,
							completedLoaded: false,
						}),
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
		const lists = extra.lists ?? this.state.lists;
		const allTasks = this.deriveAllTasks(lists);
		this.patch({
			allTasks,
			tasks: deriveSelection(allTasks, lists, selection),
			counts: deriveCounts(allTasks, lists),
			completedLoaded: lists.length > 0 && lists.every((list) => this.completedListIds.has(list.id)),
			...extra,
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Selection                                                              */
	/* ---------------------------------------------------------------------- */

	private resolveInitialSelection(): ListSelection {
		const settings = this.getSettings();
		switch (settings.defaultView) {
			case "all":
				return { kind: "smart", id: "all" };
			case "myDay":
				return { kind: "smart", id: "myDay" };
			case "important":
				return { kind: "smart", id: "important" };
			case "defaultList":
				return settings.defaultListId
					? { kind: "list", id: settings.defaultListId }
					: DEFAULT_SELECTION;
			case "last":
			default: {
				const last = settings.lastSelection;
				// A selection saved by an older version may name a smart list
				// that no longer exists.
				if (last?.kind === "smart" && !SMART_LISTS.some((smart) => smart.id === last.id)) {
					return DEFAULT_SELECTION;
				}
				return last ?? DEFAULT_SELECTION;
			}
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
				? this.state.lists.some((list) => !this.loadedListIds.has(list.id))
				: !this.loadedListIds.has(selection.id));

		if (needsFetch && this.auth.isSignedIn) {
			await this.refresh({ force: true, background: this.state.allTasks.length > 0 });
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

		const showSpinner = !options.background && this.state.allTasks.length === 0;
		this.patch({ status: showSpinner ? "loading" : "refreshing", error: null });

		this.inFlight = this.runRefresh().finally(() => {
			this.inFlight = null;
		});
		return this.inFlight;
	}

	private async runRefresh(): Promise<void> {
		try {
			// Planner runs alongside To Do; it never fails the refresh.
			const plannerDone = this.refreshPlanner();
			const lists = await this.api.getLists();

			// Forget cache for lists that no longer exist.
			const liveIds = new Set(lists.map((list) => list.id));
			for (const id of [...this.cache.keys()]) {
				if (!liveIds.has(id)) {
					this.cache.delete(id);
					this.loadedListIds.delete(id);
					this.completedListIds.delete(id);
				}
			}

			this.recompute({ lists });

			const targets = this.listsToFetch(lists);
			const showCompleted = this.getSettings().showCompleted;

			const results = await mapLimitSettled(targets, LIST_FETCH_CONCURRENCY, async (list) => {
				const withCompleted = showCompleted || this.completedListIds.has(list.id);
				const tasks = await this.api.getTasks(list.id, { completed: withCompleted ? "include" : "exclude" });
				return { listId: list.id, tasks, withCompleted };
			});

			const failures: unknown[] = [];
			for (const result of results) {
				if (result.ok) {
					this.cache.set(result.value.listId, result.value.tasks);
					this.loadedListIds.add(result.value.listId);
					if (result.value.withCompleted) this.completedListIds.add(result.value.listId);
				} else {
					failures.push(result.error);
				}
			}

			// One flaky list shouldn't blank the panel; total failure should surface.
			if (failures.length > 0 && failures.length === targets.length) {
				throw toAppError(failures[0]);
			}

			await plannerDone;

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
	 * Fetches "Assigned to me". A personal account has no Planner and answers
	 * with an error; that switches the view off rather than reporting a failure.
	 * A transient failure keeps whatever was there before.
	 */
	private async refreshPlanner(): Promise<void> {
		if (this.state.plannerAvailable === false) return;

		try {
			const tasks = await this.planner.getMyTasks();
			const titles = await this.planner.getPlanTitles(tasks.map((task) => task.planId));
			this.plannerTasks = tasks.map((task) => fromPlannerTask(task, titles.get(task.planId) ?? "Planner"));
			this.patch({ plannerAvailable: true });
		} catch (error) {
			const appError = toAppError(error);
			if (appError.requiresSignIn || appError.retryable || appError.kind === "network") return;
			this.plannerTasks = [];
			this.patch({ plannerAvailable: false });
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

	/**
	 * Fetches completed tasks for every list that doesn't have them yet - done
	 * lazily, the first time someone opens the Completed tab, because a
	 * long-lived list can hold thousands.
	 */
	async loadCompleted(): Promise<void> {
		if (!this.auth.isSignedIn || this.state.completedLoading) return;

		const targets = this.state.lists.filter((list) => !this.completedListIds.has(list.id));
		if (targets.length === 0) return;

		this.patch({ completedLoading: true });

		const results = await mapLimitSettled(targets, LIST_FETCH_CONCURRENCY, async (list) => ({
			listId: list.id,
			tasks: await this.api.getTasks(list.id, { completed: "only" }),
		}));

		let firstError: unknown = null;
		for (const result of results) {
			if (!result.ok) {
				firstError ??= result.error;
				continue;
			}
			const { listId, tasks } = result.value;
			const open = (this.cache.get(listId) ?? []).filter((task) => task.status !== "completed");
			this.cache.set(listId, [...open, ...tasks]);
			this.completedListIds.add(listId);
		}

		this.recompute({
			completedLoading: false,
			error: firstError ? toAppError(firstError) : this.state.error,
		});
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
		this.completedListIds.clear();
		this.plannerTasks = [];
	}

	/* ---------------------------------------------------------------------- */
	/* Derivation                                                             */
	/* ---------------------------------------------------------------------- */

	private deriveAllTasks(lists: TodoTaskList[]): TaskWithList[] {
		const all: TaskWithList[] = [];
		for (const list of lists) {
			for (const task of this.cache.get(list.id) ?? []) {
				all.push({ ...task, listId: list.id, listName: list.displayName, source: "todo" });
			}
		}
		all.push(...this.plannerTasks);
		return all;
	}

	/** Finds the freshest copy of a task, e.g. to keep a detail pane current. */
	findTask(taskId: string): TaskWithList | undefined {
		return this.state.allTasks.find((task) => task.id === taskId);
	}

	/* ---------------------------------------------------------------------- */
	/* List mutations                                                         */
	/* ---------------------------------------------------------------------- */

	async createList(displayName: string): Promise<TodoTaskList> {
		const name = displayName.trim();
		const list = await this.api.createList(name);
		this.cache.set(list.id, []);
		this.loadedListIds.add(list.id);
		this.completedListIds.add(list.id);
		this.recompute({ lists: [...this.state.lists, list] });
		return list;
	}

	async renameList(listId: string, displayName: string): Promise<void> {
		const name = displayName.trim();
		const previous = this.state.lists;
		const current = previous.find((list) => list.id === listId);
		if (!current || !name || current.displayName === name) return;

		this.recompute({ lists: previous.map((list) => (list.id === listId ? { ...list, displayName: name } : list)) });

		try {
			const updated = await this.api.renameList(listId, name);
			this.recompute({
				lists: this.state.lists.map((list) => (list.id === listId ? { ...list, ...updated } : list)),
			});
		} catch (error) {
			this.recompute({ lists: previous });
			throw toAppError(error);
		}
	}

	async deleteList(listId: string): Promise<void> {
		const previousLists = this.state.lists;
		const previousTasks = this.cache.get(listId);

		const lists = previousLists.filter((list) => list.id !== listId);
		this.cache.delete(listId);
		const selection = this.state.selection;
		const nextSelection = selection.kind === "list" && selection.id === listId ? DEFAULT_SELECTION : selection;
		if (nextSelection !== selection) this.persistSelection(nextSelection);
		this.recompute({ lists, selection: nextSelection });

		try {
			await this.api.deleteList(listId);
			this.loadedListIds.delete(listId);
			this.completedListIds.delete(listId);
		} catch (error) {
			const appError = toAppError(error);
			if (appError.kind !== "not-found") {
				if (previousTasks) this.cache.set(listId, previousTasks);
				this.recompute({ lists: previousLists });
			}
			throw appError;
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Task mutations                                                         */
	/* ---------------------------------------------------------------------- */

	/**
	 * The list a new task should land in when the caller didn't name one:
	 * the configured default, else the currently selected list, else To Do's own
	 * default list, else the first list there is.
	 */
	resolveTargetListId(preferred?: string): string | null {
		const lists = this.state.lists;
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
		await this.mutate(task, (current) => applyLocally(current, input), () =>
			this.api.updateTask(task.listId, task.id, input)
		);
	}

	async renameTask(task: TaskWithList, title: string): Promise<void> {
		const trimmed = title.trim();
		if (!trimmed || trimmed === task.title) return;
		await this.updateTask(task, { title: trimmed });
	}

	async setImportance(task: TaskWithList, importance: Importance): Promise<void> {
		if (task.importance === importance) return;
		await this.updateTask(task, { importance });
	}

	async setCategories(task: TaskWithList, categories: string[]): Promise<void> {
		const unique = [...new Set(categories.map((category) => category.trim()).filter(Boolean))];
		await this.updateTask(task, { categories: unique });
	}

	async setCompleted(task: TaskWithList, completed: boolean): Promise<void> {
		const status: TaskStatus = completed ? "completed" : "notStarted";
		await this.mutate(
			task,
			(current) => ({
				...current,
				status,
				completedDateTime: completed
					? { dateTime: new Date().toISOString().replace("Z", "0000"), timeZone: "UTC" }
					: null,
			}),
			() => this.api.setCompleted(task.listId, task.id, completed)
		);
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
	 * Moves a task to another list. Graph has no move, so this is a copy and a
	 * delete, and the task comes back with a new ID - which is returned so the
	 * caller can keep it selected.
	 */
	async moveTask(task: TaskWithList, toListId: string): Promise<TodoTask> {
		if (task.listId === toListId) return task;

		const withExtras = await this.ensureExtras(task);
		this.setBusy(task.id, true);
		this.recompute();

		try {
			const moved = await this.api.moveTask(withExtras, task.listId, toListId);
			this.cache.set(
				task.listId,
				(this.cache.get(task.listId) ?? []).filter((candidate) => candidate.id !== task.id)
			);
			this.cache.set(toListId, [moved, ...(this.cache.get(toListId) ?? [])]);
			this.setBusy(task.id, false);
			this.recompute();
			return moved;
		} catch (error) {
			this.setBusy(task.id, false);
			// A failure after the copy leaves a duplicate; a refresh shows the truth.
			void this.refresh({ force: true, background: true });
			throw toAppError(error);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Subtasks and linked resources                                          */
	/* ---------------------------------------------------------------------- */

	/**
	 * Tasks normally arrive with their subtasks and links expanded inline. When
	 * Graph refused the `$expand`, fetch them for this one task on demand.
	 */
	async loadExtras(task: TaskWithList): Promise<void> {
		if (task.source !== "todo") return;
		if (task.checklistItems !== undefined && task.linkedResources !== undefined) return;

		const [checklistItems, linkedResources] = await Promise.all([
			task.checklistItems ?? this.api.getChecklistItems(task.listId, task.id),
			task.linkedResources ?? this.api.getLinkedResources(task.listId, task.id),
		]);
		this.replaceCached(task, (current) => ({ ...current, checklistItems, linkedResources }));
		this.recompute();
	}

	private async ensureExtras(task: TaskWithList): Promise<TaskWithList> {
		await this.loadExtras(task);
		return this.findTask(task.id) ?? task;
	}

	async addChecklistItem(task: TaskWithList, displayName: string): Promise<void> {
		const name = displayName.trim();
		if (!name) return;

		const created = await this.api.createChecklistItem(task.listId, task.id, name);
		this.replaceCached(task, (current) => ({
			...current,
			checklistItems: [...(current.checklistItems ?? []), created],
		}));
		this.recompute();
	}

	async updateChecklistItem(
		task: TaskWithList,
		itemId: string,
		changes: { displayName?: string; isChecked?: boolean }
	): Promise<void> {
		const apply = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
			(items ?? []).map((item) => (item.id === itemId ? { ...item, ...changes } : item));

		const previous = this.findTask(task.id)?.checklistItems;
		this.replaceCached(task, (current) => ({ ...current, checklistItems: apply(current.checklistItems) }));
		this.recompute();

		try {
			await this.api.updateChecklistItem(task.listId, task.id, itemId, changes);
		} catch (error) {
			this.replaceCached(task, (current) => ({ ...current, checklistItems: previous }));
			this.recompute();
			throw toAppError(error);
		}
	}

	async deleteChecklistItem(task: TaskWithList, itemId: string): Promise<void> {
		const previous = this.findTask(task.id)?.checklistItems;
		this.replaceCached(task, (current) => ({
			...current,
			checklistItems: (current.checklistItems ?? []).filter((item) => item.id !== itemId),
		}));
		this.recompute();

		try {
			await this.api.deleteChecklistItem(task.listId, task.id, itemId);
		} catch (error) {
			const appError = toAppError(error);
			if (appError.kind !== "not-found") {
				this.replaceCached(task, (current) => ({ ...current, checklistItems: previous }));
				this.recompute();
			}
			throw appError;
		}
	}

	async addLinkedResource(task: TaskWithList, input: LinkedResourceInput): Promise<LinkedResource> {
		const created = await this.api.createLinkedResource(task.listId, task.id, input);
		this.replaceCached(task, (current) => ({
			...current,
			linkedResources: [...(current.linkedResources ?? []), created],
		}));
		this.recompute();
		return created;
	}

	async deleteLinkedResource(task: TaskWithList, resourceId: string): Promise<void> {
		const previous = this.findTask(task.id)?.linkedResources;
		this.replaceCached(task, (current) => ({
			...current,
			linkedResources: (current.linkedResources ?? []).filter((resource) => resource.id !== resourceId),
		}));
		this.recompute();

		try {
			await this.api.deleteLinkedResource(task.listId, task.id, resourceId);
		} catch (error) {
			const appError = toAppError(error);
			if (appError.kind !== "not-found") {
				this.replaceCached(task, (current) => ({ ...current, linkedResources: previous }));
				this.recompute();
			}
			throw appError;
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Cache plumbing                                                         */
	/* ---------------------------------------------------------------------- */

	private replaceCached(task: TaskWithList, update: (current: TodoTask) => TodoTask): void {
		const tasks = this.cache.get(task.listId);
		if (!tasks) return;
		const index = tasks.findIndex((candidate) => candidate.id === task.id);
		if (index === -1) return;
		const next = [...tasks];
		next[index] = update(tasks[index]);
		this.cache.set(task.listId, next);
	}

	/**
	 * Applies `optimistic` to the cache immediately, runs `request`, then swaps in
	 * the authoritative server copy. Rolls the cache back if the request fails.
	 *
	 * A PATCH response never carries expanded subtasks or links, so those are
	 * carried over from the cached copy rather than wiped.
	 */
	private async mutate(
		task: TaskWithList,
		optimistic: (current: TodoTask) => TodoTask,
		request: () => Promise<TodoTask>
	): Promise<void> {
		if (task.source !== "todo") return;
		const previous = this.cache.get(task.listId);
		if (!previous || !previous.some((candidate) => candidate.id === task.id)) return;

		this.replaceCached(task, optimistic);
		this.setBusy(task.id, true);
		this.recompute();

		try {
			const updated = await request();
			this.replaceCached(task, (current) => ({
				...updated,
				checklistItems: updated.checklistItems ?? current.checklistItems,
				linkedResources: updated.linkedResources ?? current.linkedResources,
			}));
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

function isPlannerListId(listId: string): boolean {
	return listId.startsWith(PLANNER_LIST_PREFIX);
}

/** Tasks in a selection, open and completed, in the default due-date order. */
function deriveSelection(
	allTasks: TaskWithList[],
	lists: TodoTaskList[],
	selection: ListSelection
): TaskWithList[] {
	if (selection.kind === "list") {
		return sortTasks(
			allTasks.filter((task) => task.listId === selection.id),
			"dueDate",
			"asc"
		);
	}

	if (selection.id === "assigned") {
		return sortTasks(
			allTasks.filter((task) => task.source === "planner"),
			"dueDate",
			"asc"
		);
	}

	const listsById = new Map(lists.map((list) => [list.id, list]));
	return sortTasks(
		allTasks.filter(
			(task) => task.source === "todo" && matchesSmartList(task, listsById.get(task.listId), selection.id)
		),
		"dueDate",
		"asc"
	);
}

function deriveCounts(allTasks: TaskWithList[], lists: TodoTaskList[]): Record<string, number> {
	const counts: Record<string, number> = {};
	const listsById = new Map(lists.map((list) => [list.id, list]));

	for (const smart of SMART_LISTS) counts[selectionKey({ kind: "smart", id: smart.id })] = 0;

	for (const task of allTasks) {
		if (task.status === "completed") continue;

		if (task.source === "planner" || isPlannerListId(task.listId)) {
			counts["smart:assigned"]++;
			continue;
		}

		const listKey = selectionKey({ kind: "list", id: task.listId });
		counts[listKey] = (counts[listKey] ?? 0) + 1;

		const list = listsById.get(task.listId);
		for (const smart of SMART_LISTS) {
			if (matchesSmartList(task, list, smart.id)) counts[selectionKey({ kind: "smart", id: smart.id })]++;
		}
	}

	return counts;
}

/**
 * Presents a Planner task in To Do's shape. Planner priority runs 0-10 with
 * 1 = urgent and 3 = important; anything at or above "important" reads as
 * To Do's high importance.
 */
function fromPlannerTask(task: PlannerTask, planTitle: string): TaskWithList {
	const due = task.dueDateTime ? new Date(task.dueDateTime) : null;
	const priority = task.priority ?? 5;
	const importance: Importance = priority <= 3 ? "high" : priority >= 9 ? "low" : "normal";

	return {
		id: task.id,
		title: task.title,
		status: task.percentComplete >= 100 ? "completed" : task.percentComplete > 0 ? "inProgress" : "notStarted",
		importance,
		isReminderOn: false,
		createdDateTime: task.createdDateTime,
		lastModifiedDateTime: task.createdDateTime,
		dueDateTime: due && !Number.isNaN(due.getTime()) ? toGraphDate(due) : null,
		completedDateTime: task.completedDateTime
			? { dateTime: task.completedDateTime.replace(/Z$/, ""), timeZone: "UTC" }
			: null,
		checklistItems: [],
		linkedResources: [],
		listId: `${PLANNER_LIST_PREFIX}${task.planId}`,
		listName: planTitle,
		source: "planner",
	};
}

/** Mirrors an update onto a cached task so the UI can show it before the round trip. */
function applyLocally(task: TodoTask, input: UpdateTaskInput): TodoTask {
	const next: TodoTask = { ...task };

	if (input.title !== undefined) next.title = input.title;
	if (input.status !== undefined) next.status = input.status;
	if (input.importance !== undefined) next.importance = input.importance;
	if (input.categories !== undefined) next.categories = input.categories;
	if (input.body !== undefined) next.body = { content: input.body, contentType: "text" };
	if (input.dueDate !== undefined) {
		next.dueDateTime = input.dueDate === null ? null : toGraphDate(input.dueDate);
	}

	return next;
}
