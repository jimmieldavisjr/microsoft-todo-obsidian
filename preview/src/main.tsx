import { StrictMode, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { TodoPanel } from "../../src/components/TodoPanel";
import { TodoContextProvider, type ViewCommand, type ViewPlacement } from "../../src/components/PluginContext";
import { Icon } from "../../src/components/Icon";
import { NOTES } from "./demo-vault";
import {
	app,
	auth,
	openNote,
	plugin,
	resetDemoData,
	revealView,
	service,
	setAuthMode,
	workspace,
	type AuthMode,
} from "./preview-host";

// The plugin's real stylesheet, bundled so edits to it reload the preview too.
import "../../styles.css";

/**
 * A minimal Obsidian window around the plugin's real views: ribbon, file
 * explorer, a main-window tab and the right side panel. Both Microsoft To Do
 * views render `TodoPanel` exactly as `MicrosoftTodoView` mounts it.
 */

/* -------------------------------------------------------------------------- */
/* Preview settings: theme, accent, account state                             */
/* -------------------------------------------------------------------------- */

const ACCENTS: Array<{ name: string; h: number; s: number; l: number }> = [
	{ name: "Obsidian purple", h: 254, s: 80, l: 68 },
	{ name: "Blue", h: 211, s: 90, l: 58 },
	{ name: "Green", h: 145, s: 55, l: 45 },
	{ name: "Orange", h: 28, s: 85, l: 55 },
	{ name: "Pink", h: 330, s: 75, l: 62 },
];

// Kept per tab, so a dark tab and a light tab can sit side by side and each
// survives live reloads with its own theme and side-panel width.
function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
	const [value, setValue] = useState<T>(() => {
		const saved = sessionStorage.getItem(`mstd-preview:${key}`);
		return saved ? (JSON.parse(saved) as T) : initial;
	});
	return [
		value,
		(next: T) => {
			sessionStorage.setItem(`mstd-preview:${key}`, JSON.stringify(next));
			setValue(next);
		},
	];
}

function PreviewBar(props: {
	theme: "dark" | "light";
	onTheme: (theme: "dark" | "light") => void;
	accent: number;
	onAccent: (index: number) => void;
}): ReactElement {
	const [mode, setMode] = useState<AuthMode>(auth.mode);
	return (
		<header className="preview-bar">
			<span className="preview-bar-title">
				<strong>Microsoft To Do</strong> · plugin preview
			</span>
			<span className="preview-bar-hint">Real components and styles.css, demo data, nothing leaves the browser.</span>
			<span className="preview-bar-spacer" />

			<div className="preview-segmented" role="group" aria-label="Theme">
				{(["dark", "light"] as const).map((theme) => (
					<button
						key={theme}
						type="button"
						className={props.theme === theme ? "is-active" : ""}
						onClick={() => props.onTheme(theme)}
					>
						{theme === "dark" ? "Dark" : "Light"}
					</button>
				))}
			</div>

			<div className="preview-swatches" role="group" aria-label="Accent colour">
				{ACCENTS.map((accent, index) => (
					<button
						key={accent.name}
						type="button"
						title={accent.name}
						aria-label={accent.name}
						className={props.accent === index ? "is-active" : ""}
						style={{ background: `hsl(${accent.h} ${accent.s}% ${accent.l}%)` }}
						onClick={() => props.onAccent(index)}
					/>
				))}
			</div>

			<select
				className="preview-select"
				value={mode}
				aria-label="Account state"
				onChange={(event) => {
					const next = event.target.value as AuthMode;
					setMode(next);
					setAuthMode(next);
				}}
			>
				<option value="signed-in">Signed in</option>
				<option value="signed-out">Signed out</option>
				<option value="unconfigured">Not configured</option>
			</select>

			<button type="button" className="preview-button" onClick={() => void resetDemoData()}>
				Reset data
			</button>
		</header>
	);
}

/* -------------------------------------------------------------------------- */
/* Plugin view                                                                */
/* -------------------------------------------------------------------------- */

/** Mirrors `MicrosoftTodoView.onOpen`, including its Mod+K / Mod+Enter scope. */
function PluginView({ placement }: { placement: ViewPlacement }): ReactElement {
	const commands = useMemo(() => new EventTarget(), []);
	const value = useMemo(() => ({ app, plugin, service, commands, placement }), [commands, placement]);

	useEffect(() => {
		if (plugin.settings.refreshOnOpen) void service.refresh();
	}, []);

	function send(command: ViewCommand): void {
		commands.dispatchEvent(new Event(command));
	}

	return (
		<div
			className="view-content mstd-view"
			onKeyDown={(event) => {
				if (!(event.metaKey || event.ctrlKey)) return;
				if (event.key === "k") send("focus-search");
				else if (event.key === "Enter") send("new-task");
				else return;
				event.preventDefault();
			}}
		>
			<TodoContextProvider value={value}>
				<TodoPanel />
			</TodoContextProvider>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Obsidian chrome                                                            */
/* -------------------------------------------------------------------------- */

function useWorkspace() {
	return useSyncExternalStore(workspace.subscribe, workspace.get);
}

function Ribbon({ onToggleLeft }: { onToggleLeft: () => void }): ReactElement {
	return (
		<nav className="workspace-ribbon" aria-label="Ribbon">
			<RibbonIcon icon="panel-left" label="Toggle left sidebar" onClick={onToggleLeft} />
			<RibbonIcon icon="file-plus" label="New note" />
			<RibbonIcon icon="git-fork" label="Graph view" />
			<RibbonIcon icon="calendar-days" label="Daily note" onClick={() => openNote("Daily/Today.md")} />
			<RibbonIcon icon="check-circle-2" label="Microsoft To Do" onClick={() => void plugin.activateView()} />
			<span className="preview-bar-spacer" />
			<RibbonIcon icon="help-circle" label="Help" />
			<RibbonIcon icon="settings" label="Settings" onClick={() => plugin.openSettings()} />
		</nav>
	);
}

function RibbonIcon({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }): ReactElement {
	return (
		<button type="button" className="clickable-icon side-dock-ribbon-action" aria-label={label} title={label} onClick={onClick}>
			<Icon name={icon} />
		</button>
	);
}

function FileExplorer({ active }: { active: string }): ReactElement {
	const folders = new Map<string, string[]>();
	for (const note of NOTES) {
		const [folder, name] = note.path.split("/");
		folders.set(folder, [...(folders.get(folder) ?? []), name]);
	}
	return (
		<aside className="workspace-split mod-left-split">
			<div className="workspace-tab-header-container">
				<span className="workspace-tab-header is-active">
					<Icon name="folder-closed" />
				</span>
				<span className="workspace-tab-header">
					<Icon name="search" />
				</span>
				<span className="workspace-tab-header">
					<Icon name="bookmark" />
				</span>
			</div>
			<div className="nav-files-container">
				<div className="nav-vault-name">Demo vault</div>
				{[...folders].map(([folder, names]) => (
					<div key={folder} className="nav-folder">
						<div className="nav-folder-title">
							<Icon name="chevron-down" />
							{folder}
						</div>
						{names.map((name) => {
							const path = `${folder}/${name}`;
							return (
								<button
									key={path}
									type="button"
									className={`nav-file-title${active === path ? " is-active" : ""}`}
									onClick={() => openNote(path)}
								>
									{name.replace(/\.md$/, "")}
								</button>
							);
						})}
					</div>
				))}
			</div>
		</aside>
	);
}

function MainWindow(): ReactElement {
	const state = useWorkspace();
	const [openNotes, setOpenNotes] = useState<string[]>(["Daily/Today.md"]);

	// Opening a note from anywhere (explorer, "Linked notes") gives it a tab.
	useEffect(() => {
		if (state.mainTab !== "todo" && !openNotes.includes(state.mainTab)) setOpenNotes([...openNotes, state.mainTab]);
	}, [state.mainTab]);

	const showTodo = state.mainTodoOpen && state.mainTab === "todo";

	function closeNote(path: string): void {
		const rest = openNotes.filter((entry) => entry !== path);
		setOpenNotes(rest);
		if (state.mainTab === path) workspace.set({ mainTab: state.mainTodoOpen ? "todo" : (rest[0] ?? "todo") });
	}

	return (
		<section className={`workspace-split mod-root${state.flash === "main" ? " is-flashing" : ""}`}>
			<div className="workspace-tab-header-container">
				{openNotes.map((path) => (
					<Tab
						key={path}
						icon="file-text"
						label={path.split("/").pop()!.replace(/\.md$/, "")}
						active={state.mainTab === path}
						onSelect={() => openNote(path)}
						onClose={() => closeNote(path)}
					/>
				))}
				{state.mainTodoOpen && (
					<Tab
						icon="check-circle-2"
						label="Microsoft To Do"
						active={state.mainTab === "todo"}
						onSelect={() => workspace.set({ mainTab: "todo" })}
						onClose={() =>
							workspace.set({ mainTodoOpen: false, mainTab: openNotes[openNotes.length - 1] ?? "todo" })
						}
					/>
				)}
				<span className="preview-bar-spacer" />
				<button
					type="button"
					className="clickable-icon"
					title={state.sidebarOpen ? "Collapse right sidebar" : "Expand right sidebar"}
					onClick={() => workspace.set({ sidebarOpen: !state.sidebarOpen })}
				>
					<Icon name="panel-right" />
				</button>
			</div>
			<div className="workspace-leaf-content">
				{showTodo ? (
					<PluginView placement="main" />
				) : state.mainTab !== "todo" ? (
					<NoteView path={state.mainTab} content={state.notes[state.mainTab] ?? ""} />
				) : (
					<EmptyTab />
				)}
			</div>
		</section>
	);
}

function Tab(props: { icon: string; label: string; active: boolean; onSelect: () => void; onClose: () => void }): ReactElement {
	return (
		<div className={`workspace-tab-header${props.active ? " is-active" : ""}`} onClick={props.onSelect}>
			<Icon name={props.icon} />
			<span className="workspace-tab-header-inner-title">{props.label}</span>
			<button
				type="button"
				className="workspace-tab-header-inner-close-button"
				aria-label="Close"
				onClick={(event) => {
					event.stopPropagation();
					props.onClose();
				}}
			>
				<Icon name="x" />
			</button>
		</div>
	);
}

function EmptyTab(): ReactElement {
	return (
		<div className="empty-state">
			<p>No file is open.</p>
			<button type="button" className="preview-link" onClick={() => revealView("main")}>
				Open Microsoft To Do here
			</button>
		</div>
	);
}

/** Just enough Markdown for the demo notes: headings, lists, quotes, links. */
function NoteView({ path, content }: { path: string; content: string }): ReactElement {
	const lines = content.split("\n");
	return (
		<div className="markdown-preview-view">
			<div className="inline-title">{path.split("/").pop()!.replace(/\.md$/, "")}</div>
			{lines.map((line, index) => {
				if (line.startsWith("# ")) return null;
				if (line.startsWith("## ")) return <h2 key={index}>{line.slice(3)}</h2>;
				if (line.startsWith("> ")) return <blockquote key={index}>{line.slice(2)}</blockquote>;
				if (/^(- |\d+\. )/.test(line)) return <li key={index}>{renderInline(line.replace(/^(- |\d+\. )/, ""))}</li>;
				if (!line.trim()) return <div key={index} className="md-gap" />;
				return <p key={index}>{renderInline(line)}</p>;
			})}
		</div>
	);
}

function renderInline(text: string): Array<string | ReactElement> {
	const parts: Array<string | ReactElement> = [];
	const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		parts.push(text.slice(last, match.index));
		parts.push(
			match[1] ? (
				<a key={match.index} href={match[2]} target="_blank" rel="noreferrer" className="external-link">
					{match[1]}
				</a>
			) : (
				<strong key={match.index}>{match[3]}</strong>
			)
		);
		last = (match.index ?? 0) + match[0].length;
	}
	parts.push(text.slice(last));
	return parts;
}

function RightSidebar(): ReactElement {
	const state = useWorkspace();
	const [tab, setTab] = useState<"todo" | "backlinks" | "outline">("todo");
	const [width, setWidth] = usePersistentState("sidebar-width", 360);
	const dragging = useRef(false);

	useEffect(() => {
		if (state.flash === "sidebar") setTab("todo");
	}, [state.flash]);

	useEffect(() => {
		const move = (event: PointerEvent): void => {
			if (!dragging.current) return;
			setWidth(Math.min(Math.max(window.innerWidth - event.clientX, 260), window.innerWidth - 420));
		};
		const up = (): void => {
			dragging.current = false;
			document.body.classList.remove("is-resizing");
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
	}, []);

	if (!state.sidebarOpen) return <></>;

	return (
		<>
			<div
				className="workspace-leaf-resize-handle"
				title="Drag to resize: the side panel switches layout as it widens"
				onPointerDown={() => {
					dragging.current = true;
					document.body.classList.add("is-resizing");
				}}
			/>
			<aside
				className={`workspace-split mod-right-split${state.flash === "sidebar" ? " is-flashing" : ""}`}
				style={{ width }}
			>
				<div className="workspace-tab-header-container">
					<SideTab icon="link" label="Backlinks" active={tab === "backlinks"} onClick={() => setTab("backlinks")} />
					<SideTab icon="list" label="Outline" active={tab === "outline"} onClick={() => setTab("outline")} />
					<SideTab icon="check-circle-2" label="Microsoft To Do" active={tab === "todo"} onClick={() => setTab("todo")} />
					<span className="preview-bar-spacer" />
					<span className="preview-width">{Math.round(width)}px</span>
				</div>
				<div className="workspace-leaf-content">
					{tab === "todo" ? (
						<PluginView placement="sidebar" />
					) : (
						<div className="empty-state">
							<p>{tab === "backlinks" ? "No backlinks found." : "No headings in this note."}</p>
						</div>
					)}
				</div>
			</aside>
		</>
	);
}

function SideTab(props: { icon: string; label: string; active: boolean; onClick: () => void }): ReactElement {
	return (
		<button
			type="button"
			className={`workspace-tab-header${props.active ? " is-active" : ""}`}
			title={props.label}
			aria-label={props.label}
			onClick={props.onClick}
		>
			<Icon name={props.icon} />
		</button>
	);
}

function StatusBar(): ReactElement {
	const { lastSyncAt, status } = useSyncExternalStore(service.subscribe, service.getState);
	return (
		<footer className="status-bar">
			<span>{status !== "idle" ? "Microsoft To Do: syncing…" : lastSyncAt ? "Microsoft To Do: synced" : "Microsoft To Do"}</span>
			<span>0 backlinks</span>
		</footer>
	);
}

function Preview(): ReactElement {
	const [theme, setTheme] = usePersistentState<"dark" | "light">("theme", "dark");
	const [accent, setAccent] = usePersistentState("accent", 0);
	const [leftOpen, setLeftOpen] = usePersistentState("left-open", true);
	const state = useWorkspace();

	useEffect(() => {
		const { h, s, l } = ACCENTS[accent] ?? ACCENTS[0];
		document.body.className = `theme-${theme}`;
		document.body.style.setProperty("--accent-h", String(h));
		document.body.style.setProperty("--accent-s", `${s}%`);
		document.body.style.setProperty("--accent-l", `${l}%`);
	}, [theme, accent]);

	return (
		<>
			<PreviewBar theme={theme} onTheme={setTheme} accent={accent} onAccent={setAccent} />
			<div className="app-container">
				<div className="workspace">
					<Ribbon onToggleLeft={() => setLeftOpen(!leftOpen)} />
					{leftOpen && <FileExplorer active={state.mainTab} />}
					<MainWindow />
					<RightSidebar />
				</div>
				<StatusBar />
			</div>
		</>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Preview />
	</StrictMode>
);
