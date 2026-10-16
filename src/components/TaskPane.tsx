import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Menu, Notice } from "obsidian";
import { Icon } from "./Icon";
import { AddTask } from "./AddTask";
import { TaskRow } from "./TaskRow";
import { useTodoContext, usePreferences, useTodoState, useViewCommand } from "./PluginContext";
import { usePanelState } from "./PanelState";
import { describeError } from "../errors";
import { startOfToday } from "../util/date";
import { resolveListAppearance, tintStyle } from "../util/appearance";
import { showTaskCreatedNotice } from "../util/task-links";
import {
	matchesFilter,
	matchesSearch,
	sortTasks,
	SORT_FIELDS,
	TASK_FILTERS,
	type TaskFilter,
} from "../util/task-filters";
import { SMART_LISTS, selectionKey, type CreateTaskInput, type ListSelection, type TodoTaskList } from "../types/microsoft-todo";

/**
 * Middle column: search and New Task, the view's heading, filter tabs with
 * sorting, and the tasks themselves.
 */
export function TaskPane(): ReactElement {
	const state = useTodoState();
	const panel = usePanelState();
	const preferences = usePreferences();

	const searching = panel.search.trim().length > 0;

	const visible = useMemo(() => {
		// Search reaches across every list; otherwise we stay inside the selection.
		const source = searching ? state.allTasks : state.tasks;
		const matches = source.filter(
			(task) => matchesFilter(task, panel.filter) && (!searching || matchesSearch(task, panel.search))
		);
		return sortTasks(matches, preferences.sortField, preferences.sortDirection);
	}, [
		searching,
		state.allTasks,
		state.tasks,
		panel.filter,
		panel.search,
		preferences.sortField,
		preferences.sortDirection,
	]);

	const listMissing =
		state.selection.kind === "list" &&
		!state.lists.some((list) => list.id === state.selection.id) &&
		state.lists.length > 0 &&
		state.status !== "loading";

	return (
		<main className="mstd-main">
			<Toolbar />

			<div className="mstd-main-scroll">
				<Heading searching={searching} resultCount={visible.length} />

				<ErrorBanner />

				{panel.composerOpen && <Composer />}

				<FilterBar />

				{listMissing ? (
					<EmptyState icon="alert-circle" message="That list is no longer in Microsoft To Do. Choose another one." />
				) : (
					<TaskRows
						tasks={visible}
						showListNames={searching || state.selection.kind === "smart"}
						emptyMessage={emptyMessage(state.selection, panel.filter, searching)}
					/>
				)}
			</div>
		</main>
	);
}

/* -------------------------------------------------------------------------- */
/* Toolbar                                                                    */
/* -------------------------------------------------------------------------- */

function Toolbar(): ReactElement {
	const { plugin, service, placement } = useTodoContext();
	const state = useTodoState();
	const panel = usePanelState();
	const busy = state.status !== "idle";

	useViewCommand(
		"focus-search",
		useCallback(() => {
			panel.searchRef.current?.focus();
			panel.searchRef.current?.select();
		}, [panel.searchRef])
	);
	useViewCommand(
		"new-task",
		useCallback(() => panel.setComposerOpen(true), [panel])
	);

	return (
		<div className="mstd-toolbar">
			{panel.layout === "narrow" && (
				<button
					type="button"
					className="mstd-icon-button"
					aria-label="Show lists"
					title="Lists"
					onClick={() => panel.setSidebarOpen(true)}
				>
					<Icon name="menu" />
				</button>
			)}

			<label className="mstd-search">
				<Icon name="search" className="mstd-search-icon" />
				<input
					ref={panel.searchRef}
					type="search"
					className="mstd-search-input"
					placeholder="Search tasks…"
					value={panel.search}
					onChange={(event) => panel.setSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							panel.setSearch("");
							event.currentTarget.blur();
						}
					}}
					aria-label="Search tasks"
				/>
				{panel.search && (
					<button
						type="button"
						className="mstd-search-clear"
						aria-label="Clear search"
						onClick={() => panel.setSearch("")}
					>
						<Icon name="x" />
					</button>
				)}
			</label>

			<button
				type="button"
				className={`mstd-icon-button${busy ? " is-spinning" : ""}`}
				title="Refresh"
				aria-label="Refresh tasks"
				disabled={busy}
				onClick={() => void service.refresh({ force: true, background: true })}
			>
				<Icon name="refresh-cw" />
			</button>

			{/* The other location stays open alongside this one, showing the same tasks. */}
			<button
				type="button"
				className="mstd-icon-button"
				title={placement === "main" ? "Open in side panel" : "Open in main window"}
				aria-label={placement === "main" ? "Open in side panel" : "Open in main window"}
				onClick={() => void plugin.activateView({ placement: placement === "main" ? "sidebar" : "main" })}
			>
				<Icon name={placement === "main" ? "panel-right" : "maximize-2"} />
			</button>

			<button
				type="button"
				className="mstd-primary-button"
				title="New task"
				onClick={() => panel.setComposerOpen(!panel.composerOpen)}
				aria-expanded={panel.composerOpen}
			>
				<Icon name="plus" />
				<span className="mstd-primary-button-label">New Task</span>
			</button>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Heading                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The view's name in the list's own colour and icon, with a quiet count (or,
 * for Today, the date) beneath. Plain text on purpose: it's a label for the
 * tasks, not a feature of its own.
 */
function Heading({ searching, resultCount }: { searching: boolean; resultCount: number }): ReactElement {
	const state = useTodoState();
	const preferences = usePreferences();
	const selection = state.selection;

	const smart = selection.kind === "smart" ? SMART_LISTS.find((entry) => entry.id === selection.id) : undefined;
	const list = selection.kind === "list" ? state.lists.find((entry) => entry.id === selection.id) : undefined;
	const appearance = list ? resolveListAppearance(list, preferences.listAppearance) : undefined;

	const title = searching ? "Search" : selectionTitle(selection, state.lists);
	const icon = searching ? "search" : (smart?.icon ?? appearance?.icon ?? "list");
	const count = searching ? resultCount : state.counts[selectionKey(selection)];

	let subtitle: string | null = null;
	if (searching) subtitle = `${resultCount} result${resultCount === 1 ? "" : "s"} across every list`;
	else if (smart?.id === "myDay")
		subtitle = startOfToday().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
	else if (count !== undefined) subtitle = count === 0 ? "No open tasks" : `${count} open task${count === 1 ? "" : "s"}`;

	return (
		<header className="mstd-heading" style={appearance && !searching ? tintStyle(appearance.color) : undefined}>
			<Icon name={icon} className="mstd-heading-icon" />
			<div className="mstd-heading-text">
				<h2 className="mstd-heading-title" title={smart?.description ?? title}>
					{title}
				</h2>
				{subtitle && <div className="mstd-heading-subtitle">{subtitle}</div>}
			</div>
		</header>
	);
}

function ErrorBanner(): ReactElement | null {
	const { plugin, service } = useTodoContext();
	const { error } = useTodoState();
	if (!error) return null;

	return (
		<div className="mstd-banner mstd-banner--error" role="alert">
			<Icon name="alert-triangle" />
			<div className="mstd-banner-body">
				<div className="mstd-banner-text">{describeError(error)}</div>
				<div className="mstd-banner-actions">
					{error.requiresSignIn ? (
						<button type="button" className="mstd-text-button" onClick={() => void plugin.signIn()}>
							Reconnect
						</button>
					) : (
						<button
							type="button"
							className="mstd-text-button"
							onClick={() => void service.refresh({ force: true, background: true })}
						>
							Try again
						</button>
					)}
					<button type="button" className="mstd-text-button" onClick={() => service.clearError()}>
						Dismiss
					</button>
				</div>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

function Composer(): ReactElement {
	const { service } = useTodoContext();
	const state = useTodoState();
	const panel = usePanelState();

	const selection = state.selection;
	const isSmart = selection.kind === "smart";
	const list = !isSmart ? state.lists.find((entry) => entry.id === selection.id) : undefined;
	const writableLists = state.lists.filter((entry) => entry.wellknownListName !== "flaggedEmails");

	/** Only meaningful in a smart view, where the target list is ambiguous. */
	const [overrideListId, setOverrideListId] = useState<string | null>(null);

	const targetListId = useMemo(() => {
		if (list) return list.id;
		// Drop a stale override if that list disappeared.
		const valid = overrideListId && writableLists.some((entry) => entry.id === overrideListId);
		return valid ? overrideListId : service.resolveTargetListId();
	}, [list, overrideListId, writableLists, service]);

	const onCreate = useCallback(
		async (input: CreateTaskInput, listId: string) => {
			try {
				const task = await service.createTask(listId, input);
				showTaskCreatedNotice(`Added "${input.title}" to Microsoft To Do.`, task.id);
				// Open the new task for subtasks and tags - but only where details
				// sit alongside the list, so quick entry isn't interrupted.
				if (panel.layout === "wide") panel.selectTask(task.id);
			} catch (error) {
				new Notice(describeError(error));
				throw error;
			}
		},
		[service, panel]
	);

	const smartId = isSmart ? selection.id : null;

	return (
		<div className="mstd-composer-card">
			<AddTask
				lists={writableLists}
				targetListId={targetListId}
				onChangeTargetList={setOverrideListId}
				showListPicker={isSmart}
				autoFocus
				// A task created inside a smart view should actually appear in it.
				defaultDueDate={smartId === "myDay" || smartId === "planned" ? startOfToday() : null}
				defaultImportance={smartId === "important" ? "high" : "normal"}
				onCreate={onCreate}
				onCancel={() => panel.setComposerOpen(false)}
			/>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Filters and sorting                                                        */
/* -------------------------------------------------------------------------- */

function FilterBar(): ReactElement {
	const { plugin } = useTodoContext();
	const panel = usePanelState();
	const preferences = usePreferences();

	const field = SORT_FIELDS.find((entry) => entry.id === preferences.sortField) ?? SORT_FIELDS[0];

	function openSortMenu(event: MouseEvent): void {
		const menu = new Menu();
		for (const option of SORT_FIELDS) {
			menu.addItem((item) =>
				item
					.setTitle(option.label)
					.setIcon(option.icon)
					.setChecked(option.id === preferences.sortField)
					.onClick(() => void plugin.updatePreferences({ sortField: option.id }))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Ascending")
				.setIcon("arrow-up")
				.setChecked(preferences.sortDirection === "asc")
				.onClick(() => void plugin.updatePreferences({ sortDirection: "asc" }))
		);
		menu.addItem((item) =>
			item
				.setTitle("Descending")
				.setIcon("arrow-down")
				.setChecked(preferences.sortDirection === "desc")
				.onClick(() => void plugin.updatePreferences({ sortDirection: "desc" }))
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Comfortable rows")
				.setIcon("layout-list")
				.setChecked(preferences.density === "comfortable")
				.onClick(() => void plugin.updatePreferences({ density: "comfortable" }))
		);
		menu.addItem((item) =>
			item
				.setTitle("Compact rows")
				.setIcon("list")
				.setChecked(preferences.density === "compact")
				.onClick(() => void plugin.updatePreferences({ density: "compact" }))
		);
		menu.showAtMouseEvent(event);
	}

	return (
		<div className="mstd-filterbar">
			<div className="mstd-tabs" role="tablist" aria-label="Filter tasks">
				{TASK_FILTERS.map((filter) => (
					<button
						key={filter.id}
						type="button"
						role="tab"
						aria-selected={panel.filter === filter.id}
						className={`mstd-tab${panel.filter === filter.id ? " is-active" : ""}`}
						onClick={() => panel.setFilter(filter.id)}
					>
						{filter.label}
					</button>
				))}
			</div>

			<div className="mstd-sort">
				<button
					type="button"
					className="mstd-sort-button"
					title="Sort and view options"
					onClick={(event) => openSortMenu(event.nativeEvent)}
				>
					<Icon name="arrow-up-down" />
					<span className="mstd-sort-label">{field.label}</span>
				</button>
				<button
					type="button"
					className="mstd-sort-direction"
					aria-label={preferences.sortDirection === "asc" ? "Sort descending" : "Sort ascending"}
					title={preferences.sortDirection === "asc" ? "Ascending" : "Descending"}
					onClick={() =>
						void plugin.updatePreferences({
							sortDirection: preferences.sortDirection === "asc" ? "desc" : "asc",
						})
					}
				>
					<Icon name={preferences.sortDirection === "asc" ? "chevron-up" : "chevron-down"} />
				</button>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                       */
/* -------------------------------------------------------------------------- */

function TaskRows({
	tasks,
	showListNames,
	emptyMessage,
}: {
	tasks: ReturnType<typeof sortTasks>;
	showListNames: boolean;
	emptyMessage: string;
}): ReactElement {
	const state = useTodoState();
	const panel = usePanelState();
	const preferences = usePreferences();

	const busy = useMemo(() => new Set(state.busyTaskIds), [state.busyTaskIds]);
	const listsById = useMemo(() => new Map(state.lists.map((list) => [list.id, list])), [state.lists]);

	const loading = state.status === "loading" || (panel.filter === "completed" && state.completedLoading);

	if (tasks.length === 0) {
		return loading ? (
			<EmptyState spinner message={panel.filter === "completed" ? "Loading completed tasks…" : "Loading tasks…"} />
		) : (
			<EmptyState icon={panel.search ? "search-x" : "check-circle-2"} message={emptyMessage} />
		);
	}

	return (
		<ul className="mstd-rows">
			{tasks.map((task) => {
				const list = listsById.get(task.listId);
				return (
					<TaskRow
						key={task.id}
						task={task}
						busy={busy.has(task.id)}
						selected={panel.selectedTaskId === task.id}
						showListName={showListNames}
						listColor={list ? resolveListAppearance(list, preferences.listAppearance).color : undefined}
					/>
				);
			})}
		</ul>
	);
}

function EmptyState({ icon, message, spinner }: { icon?: string; message: string; spinner?: boolean }): ReactElement {
	return (
		<div className="mstd-empty">
			{spinner ? <span className="mstd-spinner" /> : <Icon name={icon ?? "check-circle-2"} className="mstd-empty-icon" />}
			<p>{message}</p>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function selectionTitle(selection: ListSelection, lists: TodoTaskList[]): string {
	if (selection.kind === "smart") return SMART_LISTS.find((smart) => smart.id === selection.id)?.label ?? "Tasks";
	return lists.find((list) => list.id === selection.id)?.displayName ?? "Tasks";
}

function emptyMessage(selection: ListSelection, filter: TaskFilter, searching: boolean): string {
	if (searching) return "No tasks match your search.";

	switch (filter) {
		case "today":
			return "Nothing due today.";
		case "upcoming":
			return "Nothing scheduled ahead.";
		case "overdue":
			return "Nothing overdue. Nice.";
		case "completed":
			return "No completed tasks here yet.";
		case "all":
			break;
	}

	if (selection.kind === "list") return "No tasks in this list yet.";

	// Spells out how the smart views are derived, since Graph has none of them.
	switch (selection.id) {
		case "myDay":
			return "Nothing due today or overdue, across any list.";
		case "important":
			return "No tasks marked important, across any list.";
		case "planned":
			return "No tasks with a due date, across any list.";
		case "assigned":
			return "No Planner tasks are assigned to you.";
		case "flagged":
			return "No flagged emails.";
		case "all":
			return "You're all caught up.";
	}
}
