import { useCallback, useEffect, useMemo, useState } from "react";
import { Notice } from "obsidian";
import { Icon } from "./Icon";
import { AddTask } from "./AddTask";
import { TaskList } from "./TaskList";
import { useTodoContext, useTodoState } from "./PluginContext";
import { describeError } from "../errors";
import { startOfToday } from "../util/date";
import {
	SMART_LISTS,
	selectionKey,
	type CreateTaskInput,
	type ListSelection,
	type TodoTaskList,
} from "../types/microsoft-todo";

const TODO_WEB_URL = "https://to-do.office.com/tasks/";

/**
 * Root of the Microsoft To Do view.
 *
 * Every child is declared at module scope and reads what it needs from context:
 * components defined inside the render body would be a new component type on
 * each render, so React would remount them and throw away the open task, the
 * add-task draft, and the collapsed state of the list sidebar.
 */
export function TodoPanel(): JSX.Element {
	const state = useTodoState();

	if (!state.configured) return <SetupCard />;
	if (!state.signedIn) return <SignInCard />;

	return (
		<div className="mstd-panel">
			<TopBar />
			<ErrorBanner />
			<TaskScroll />
			<ListSidebar />
			<PanelFooter />
		</div>
	);
}

/**
 * Heading and composer share one surface: in Fluent terms they are the command
 * area of this view, layered above the task list rather than floating in it.
 * They sit on the card layer with a single stroke closing the band off, which
 * is what separates "what I'm doing" from "what's in the list".
 */
function TopBar(): JSX.Element {
	return (
		<div className="mstd-topbar">
			<PanelHeader />
			<Composer />
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Heads the panel the way To Do heads a list: the list name is the only thing
 * competing for attention, with actions on its baseline and a quiet subtitle
 * carrying the count (or, for My Day, today's date).
 *
 * There is deliberately no "Microsoft To Do" eyebrow - Obsidian's own view tab
 * already says that, and it was pushing the real heading down a row.
 */
function PanelHeader(): JSX.Element {
	const { plugin, service } = useTodoContext();
	const state = useTodoState();

	const selection = state.selection;
	const smart = selection.kind === "smart" ? SMART_LISTS.find((entry) => entry.id === selection.id) : undefined;
	const list = selection.kind === "list" ? state.lists.find((entry) => entry.id === selection.id) : undefined;

	const busy = state.status === "refreshing" || state.status === "loading";
	const subtitle = subtitleFor(selection);

	return (
		<div className="mstd-header">
			<div className="mstd-header-top">
				<Icon
					name={smart?.icon ?? (list ? listIcon(list) : "list")}
					className="mstd-header-icon"
				/>
				<h2 className="mstd-header-title" title={smart?.description ?? list?.displayName}>
					{smart?.label ?? list?.displayName ?? "Tasks"}
				</h2>

				<div className="mstd-header-actions">
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
					<button
						type="button"
						className="mstd-icon-button"
						title="Plugin settings"
						aria-label="Plugin settings"
						onClick={() => plugin.openSettings()}
					>
						<Icon name="settings" />
					</button>
				</div>
			</div>

			{subtitle && <div className="mstd-header-subtitle">{subtitle}</div>}
		</div>
	);
}

/**
 * Only My Day gets a subtitle, and it's the date - the way To Do heads it.
 * Task counts deliberately don't appear here; the list navigation at the foot
 * of the panel already carries a count for every list, including this one.
 */
function subtitleFor(selection: ListSelection): string | null {
	if (selection.kind === "smart" && selection.id === "myDay") {
		return startOfToday().toLocaleDateString(undefined, {
			weekday: "long",
			day: "numeric",
			month: "long",
		});
	}
	return null;
}

function ErrorBanner(): JSX.Element | null {
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

function PanelFooter(): JSX.Element {
	const { lastSyncAt } = useTodoState();
	useMinuteTick();

	return (
		<div className="mstd-footer">
			<span>{lastSyncAt ? `Synced ${formatRelative(lastSyncAt)}` : "Not synced yet"}</span>
			<a href={TODO_WEB_URL} className="mstd-footer-link">
				Open Microsoft To Do
			</a>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

function Composer(): JSX.Element {
	const { service } = useTodoContext();
	const state = useTodoState();

	const selection = state.selection;
	const isSmart = selection.kind === "smart";
	const list = !isSmart ? state.lists.find((entry) => entry.id === selection.id) : undefined;

	/** Only meaningful in a smart view, where the target list is ambiguous. */
	const [overrideListId, setOverrideListId] = useState<string | null>(null);

	const targetListId = useMemo(() => {
		if (!isSmart) return list?.id ?? service.resolveTargetListId();
		// Drop a stale override if that list disappeared.
		const valid = overrideListId && state.lists.some((entry) => entry.id === overrideListId);
		return valid ? overrideListId : service.resolveTargetListId();
	}, [isSmart, list?.id, overrideListId, state.lists, service]);

	const onCreate = useCallback(
		async (input: CreateTaskInput, listId: string) => {
			try {
				await service.createTask(listId, input);
			} catch (error) {
				new Notice(describeError(error));
				throw error;
			}
		},
		[service]
	);

	return (
		<AddTask
			lists={state.lists}
			targetListId={targetListId}
			onChangeTargetList={setOverrideListId}
			showListPicker={isSmart}
			// A task created inside a smart view should actually appear in it.
			defaultDueDate={isSmart && selection.id === "myDay" ? startOfToday() : null}
			defaultImportance={isSmart && selection.id === "important" ? "high" : "normal"}
			onCreate={onCreate}
		/>
	);
}

function TaskScroll(): JSX.Element {
	const state = useTodoState();
	const selection = state.selection;
	const isSmart = selection.kind === "smart";
	const list = !isSmart ? state.lists.find((entry) => entry.id === selection.id) : undefined;

	const listMissing = !isSmart && !list && state.lists.length > 0 && state.status !== "loading";

	if (listMissing) {
		return (
			<div className="mstd-task-scroll">
				<div className="mstd-empty">
					<Icon name="alert-circle" className="mstd-empty-icon" />
					<p>That list is no longer in Microsoft To Do. Choose another one below.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mstd-task-scroll">
			<TaskList
				// Remounting on selection change resets which task is expanded
				// and whether the completed group is open.
				key={selectionKey(selection)}
				tasks={state.tasks}
				busyTaskIds={state.busyTaskIds}
				showListNames={isSmart}
				loading={state.status === "loading"}
				emptyMessage={emptyMessageFor(selection)}
			/>
		</div>
	);
}

/**
 * Mirrors the icons Microsoft To Do gives its own lists: a house for the
 * built-in default list ("Tasks"), a flag for flagged email, and a generic
 * list glyph for everything the user made themselves.
 */
function listIcon(list: TodoTaskList): string {
	switch (list.wellknownListName) {
		case "defaultList":
			return "home";
		case "flaggedEmails":
			return "flag";
		default:
			return "list";
	}
}

function emptyMessageFor(selection: ListSelection): string {
	if (selection.kind === "list") return "No tasks in this list yet.";
	// Spells out how these views are derived, since Graph has no My Day list.
	return selection.id === "myDay"
		? "Nothing due today or overdue, across any list."
		: "No tasks marked important, across any list.";
}

/* -------------------------------------------------------------------------- */
/* List sidebar                                                               */
/* -------------------------------------------------------------------------- */

function ListSidebar(): JSX.Element {
	const { service } = useTodoContext();
	const state = useTodoState();
	const [collapsed, setCollapsed] = useState(false);
	const selection = state.selection;

	return (
		<div className="mstd-lists">
			<button
				type="button"
				className="mstd-lists-toggle"
				aria-expanded={!collapsed}
				onClick={() => setCollapsed(!collapsed)}
			>
				<Icon name={collapsed ? "chevron-right" : "chevron-down"} />
				<span>Lists</span>
			</button>

			{!collapsed && (
				<ul className="mstd-list-items">
					{SMART_LISTS.map((smart) => (
						<ListRow
							key={smart.id}
							icon={smart.icon}
							label={smart.label}
							count={state.counts[selectionKey({ kind: "smart", id: smart.id })]}
							active={selection.kind === "smart" && selection.id === smart.id}
							onSelect={() => void service.select({ kind: "smart", id: smart.id })}
						/>
					))}

					<li className="mstd-list-separator" role="separator" />

					{state.lists.map((list) => (
						<ListRow
							key={list.id}
							icon={listIcon(list)}
							label={list.displayName}
							count={state.counts[selectionKey({ kind: "list", id: list.id })]}
							active={selection.kind === "list" && selection.id === list.id}
							onSelect={() => void service.select({ kind: "list", id: list.id })}
						/>
					))}

					{state.lists.length === 0 && state.status !== "loading" && (
						<li className="mstd-list-empty">No lists found in Microsoft To Do.</li>
					)}
				</ul>
			)}
		</div>
	);
}

function ListRow(props: {
	icon: string;
	label: string;
	count: number | undefined;
	active: boolean;
	onSelect: () => void;
}): JSX.Element {
	return (
		<li>
			<button
				type="button"
				className={`mstd-list-item${props.active ? " is-active" : ""}`}
				aria-current={props.active ? "true" : undefined}
				onClick={props.onSelect}
			>
				<Icon name={props.icon} />
				<span className="mstd-list-label">{props.label}</span>
				{props.count !== undefined && props.count > 0 && <span className="mstd-count">{props.count}</span>}
			</button>
		</li>
	);
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

function SetupCard(): JSX.Element {
	const { plugin } = useTodoContext();

	return (
		<div className="mstd-panel mstd-setup">
			<Icon name="key-round" className="mstd-setup-icon" />
			<h2>Connect Microsoft To Do</h2>
			<p>
				This plugin reaches your tasks through Microsoft Graph, which needs a free Azure app registration. Add its{" "}
				<strong>Application (client) ID</strong> in the plugin settings to get started.
			</p>
			<button type="button" className="mod-cta" onClick={() => plugin.openSettings()}>
				Open plugin settings
			</button>
		</div>
	);
}

function SignInCard(): JSX.Element {
	const { plugin } = useTodoContext();
	const [signingIn, setSigningIn] = useState(false);

	return (
		<div className="mstd-panel mstd-setup">
			<Icon name="user-circle" className="mstd-setup-icon" />
			<h2>Sign in to Microsoft</h2>
			<p>
				You&rsquo;ll get a short code to enter at microsoft.com/devicelogin. Your lists load as soon as you&rsquo;re
				signed in.
			</p>
			<button
				type="button"
				className="mod-cta"
				disabled={signingIn}
				onClick={async () => {
					// `signIn` reports its own failures; we only track the button state.
					setSigningIn(true);
					try {
						await plugin.signIn();
					} finally {
						setSigningIn(false);
					}
				}}
			>
				{signingIn ? "Waiting for sign-in…" : "Connect Microsoft account"}
			</button>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatRelative(timestamp: number): string {
	const seconds = Math.round((Date.now() - timestamp) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	return new Date(timestamp).toLocaleDateString();
}

/** Keeps the footer's relative timestamp honest without a global timer. */
function useMinuteTick(): void {
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = window.setInterval(() => setTick((value) => value + 1), 60_000);
		return () => window.clearInterval(id);
	}, []);
}
