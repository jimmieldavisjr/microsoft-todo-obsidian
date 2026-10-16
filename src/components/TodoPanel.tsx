import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { Icon } from "./Icon";
import { Sidebar } from "./Sidebar";
import { TaskPane } from "./TaskPane";
import { DetailPane } from "./DetailPane";
import { useTodoContext, usePreferences, useTodoState } from "./PluginContext";
import { layoutForWidth, PanelStateProvider, type Layout, type PanelState } from "./PanelState";
import type { TaskFilter } from "../util/task-filters";

/**
 * Root of the Microsoft To Do view: lists, tasks and task details side by side.
 *
 * Every child is declared at module scope and reads what it needs from context:
 * components defined inside the render body would be a new component type on
 * each render, so React would remount them and throw away drafts and focus.
 */
export function TodoPanel(): ReactElement {
	const state = useTodoState();

	if (!state.configured) return <SetupCard />;
	if (!state.signedIn) return <SignInCard />;

	return <Shell />;
}

function Shell(): ReactElement {
	const { service } = useTodoContext();
	const state = useTodoState();
	const preferences = usePreferences();

	const rootRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const layout = useLayout(rootRef);

	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [filter, setFilter] = useState<TaskFilter>("all");
	const [search, setSearch] = useState("");
	const [composerOpen, setComposerOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const selectedTask = selectedTaskId ? state.allTasks.find((task) => task.id === selectedTaskId) : undefined;

	// A task deleted or moved elsewhere takes the selection with it. Held off
	// while loading, when the task may simply not have arrived yet.
	useEffect(() => {
		if (selectedTaskId && !selectedTask && state.status === "idle") setSelectedTaskId(null);
	}, [selectedTaskId, selectedTask, state.status]);

	// Completed tasks are fetched lazily, the first time anyone asks for them.
	useEffect(() => {
		if (filter === "completed" && !state.completedLoaded) void service.loadCompleted();
	}, [filter, state.completedLoaded, service]);

	// Picking a list from the drawer should get the drawer out of the way.
	useEffect(() => {
		setSidebarOpen(false);
	}, [state.selection]);

	const selectTask = useCallback((taskId: string | null) => setSelectedTaskId(taskId), []);

	const panel = useMemo<PanelState>(
		() => ({
			layout,
			selectedTaskId: selectedTask ? selectedTaskId : null,
			selectTask,
			filter,
			setFilter,
			search,
			setSearch,
			searchRef,
			composerOpen,
			setComposerOpen,
			sidebarOpen,
			setSidebarOpen,
		}),
		[layout, selectedTask, selectedTaskId, selectTask, filter, search, composerOpen, sidebarOpen]
	);

	const detailIsOverlay = layout !== "wide";
	const showDetail = layout === "wide" || !!selectedTask;
	const showSidebar = layout !== "narrow" || sidebarOpen;

	return (
		<PanelStateProvider value={panel}>
			<div
				ref={rootRef}
				className={`mstd-shell is-${layout} is-${preferences.density}`}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || isEditable(event.target)) return;
					if (detailIsOverlay && selectedTask) {
						setSelectedTaskId(null);
						event.stopPropagation();
					} else if (sidebarOpen) {
						setSidebarOpen(false);
						event.stopPropagation();
					}
				}}
			>
				{showSidebar && (
					<>
						{layout === "narrow" && (
							<div className="mstd-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
						)}
						<Sidebar />
					</>
				)}

				<TaskPane />

				{showDetail && (
					<>
						{detailIsOverlay && (
							<div className="mstd-backdrop" onClick={() => setSelectedTaskId(null)} aria-hidden="true" />
						)}
						<DetailPane task={selectedTask} />
					</>
				)}
			</div>
		</PanelStateProvider>
	);
}

/** Tracks the view's own width, since a sidebar leaf is far narrower than the window. */
function useLayout(ref: RefObject<HTMLElement>): Layout {
	const [layout, setLayout] = useState<Layout>("wide");

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;

		const update = (): void => setLayout(layoutForWidth(element.getBoundingClientRect().width));
		update();

		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);

	return layout;
}

function isEditable(target: EventTarget): boolean {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
	);
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

function SetupCard(): ReactElement {
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

function SignInCard(): ReactElement {
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
				// Kept sync: React expects a void-returning handler, so the async
				// work is started rather than returned.
				onClick={() => {
					// `signIn` reports its own failures; we only track the button state.
					setSigningIn(true);
					void plugin.signIn().finally(() => setSigningIn(false));
				}}
			>
				{signingIn ? "Waiting for sign-in…" : "Connect Microsoft account"}
			</button>
		</div>
	);
}
