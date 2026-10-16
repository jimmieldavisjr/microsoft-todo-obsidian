import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Menu, Notice } from "obsidian";
import { Icon } from "./Icon";
import { useTodoContext, usePreferences, useTodoState } from "./PluginContext";
import { usePanelState } from "./PanelState";
import { run } from "./taskActions";
import { describeError } from "../errors";
import { resolveListAppearance, tintStyle } from "../util/appearance";
import { confirmAction, ListAppearanceModal } from "../views/modals";
import { SMART_LISTS, selectionKey, type TodoTaskList } from "../types/microsoft-todo";

/**
 * Left column: the smart views, the user's lists, and the sync footer.
 *
 * List management lives here the way it does in To Do: "Add list" at the foot
 * of the lists, and rename / customise / delete on each row's context menu.
 */
export function Sidebar(): ReactElement {
	const { service } = useTodoContext();
	const state = useTodoState();
	const panel = usePanelState();
	const preferences = usePreferences();
	const selection = state.selection;

	const hasFlagged = state.lists.some((list) => list.wellknownListName === "flaggedEmails");
	const smartLists = SMART_LISTS.filter((smart) => {
		if (smart.id === "assigned") return state.plannerAvailable === true;
		if (smart.id === "flagged") return hasFlagged;
		return true;
	});
	const userLists = state.lists.filter((list) => list.wellknownListName !== "flaggedEmails");

	return (
		<nav className={`mstd-sidebar${panel.layout === "narrow" ? " is-drawer" : ""}`} aria-label="Lists">
			<ul className="mstd-nav">
				{smartLists.map((smart) => (
					<NavRow
						key={smart.id}
						icon={smart.icon}
						label={smart.label}
						title={smart.description}
						count={state.counts[selectionKey({ kind: "smart", id: smart.id })]}
						active={selection.kind === "smart" && selection.id === smart.id}
						onSelect={() => void service.select({ kind: "smart", id: smart.id })}
					/>
				))}
			</ul>

			<div className="mstd-nav-heading">Lists</div>

			<ul className="mstd-nav mstd-nav--lists">
				{userLists.map((list) => (
					<ListNavRow key={list.id} list={list} appearance={resolveListAppearance(list, preferences.listAppearance)} />
				))}

				{userLists.length === 0 && state.status !== "loading" && (
					<li className="mstd-nav-empty">No lists yet.</li>
				)}
			</ul>

			<AddList />

			<SyncFooter />
		</nav>
	);
}

function NavRow(props: {
	icon: string;
	label: string;
	title?: string;
	count: number | undefined;
	active: boolean;
	style?: CSSProperties;
	tinted?: boolean;
	onSelect: () => void;
	onContextMenu?: (event: MouseEvent) => void;
}): ReactElement {
	return (
		<li>
			<button
				type="button"
				className={`mstd-nav-item${props.active ? " is-active" : ""}${props.tinted ? " is-tinted" : ""}`}
				aria-current={props.active ? "page" : undefined}
				title={props.title}
				style={props.style}
				onClick={props.onSelect}
				onContextMenu={(event) => {
					if (!props.onContextMenu) return;
					event.preventDefault();
					props.onContextMenu(event.nativeEvent);
				}}
			>
				<Icon name={props.icon} className="mstd-nav-icon" />
				<span className="mstd-nav-label">{props.label}</span>
				{props.count !== undefined && props.count > 0 && <span className="mstd-nav-count">{props.count}</span>}
			</button>
		</li>
	);
}

/**
 * Only lists the user made can be renamed or deleted: Graph refuses both for
 * To Do's built-in lists, and a list shared *with* you can only be left, which
 * Graph doesn't support.
 */
function canManage(list: TodoTaskList): boolean {
	return list.wellknownListName === "none" && list.isOwner;
}

function ListNavRow({
	list,
	appearance,
}: {
	list: TodoTaskList;
	appearance: { color: Parameters<typeof tintStyle>[0]; icon: string };
}): ReactElement {
	const { app, plugin, service } = useTodoContext();
	const state = useTodoState();
	const [renaming, setRenaming] = useState(false);
	const active = state.selection.kind === "list" && state.selection.id === list.id;

	function openMenu(event: MouseEvent): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle("Rename list")
				.setIcon("pencil")
				.setDisabled(!canManage(list))
				.onClick(() => setRenaming(true))
		);
		menu.addItem((item) =>
			item
				.setTitle("Colour and icon…")
				.setIcon("palette")
				.onClick(() => {
					new ListAppearanceModal(app, list, appearance, (next) => {
						void plugin.setListAppearance(list.id, next);
					}).open();
				})
		);
		if (list.isShared) {
			menu.addItem((item) => item.setTitle("Shared list").setIcon("users").setIsLabel(true));
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Delete list")
				.setIcon("trash-2")
				.setWarning(true)
				.setDisabled(!canManage(list))
				.onClick(() => void deleteList())
		);
		menu.showAtMouseEvent(event);
	}

	async function deleteList(): Promise<void> {
		const count = state.allTasks.filter((task) => task.listId === list.id).length;
		const confirmed = await confirmAction(app, {
			title: "Delete list",
			message: `"${list.displayName}"${count > 0 ? ` and its ${count} task${count === 1 ? "" : "s"}` : ""} will be permanently deleted from Microsoft To Do.`,
			confirmText: "Delete list",
			destructive: true,
		});
		if (!confirmed) return;
		if (await run(() => service.deleteList(list.id))) void plugin.setListAppearance(list.id, null);
	}

	if (renaming) {
		return (
			<li>
				<InlineNameInput
					icon={appearance.icon}
					style={tintStyle(appearance.color)}
					initial={list.displayName}
					placeholder="List name"
					onCancel={() => setRenaming(false)}
					onSubmit={async (name) => {
						setRenaming(false);
						await run(() => service.renameList(list.id, name));
					}}
				/>
			</li>
		);
	}

	return (
		<NavRow
			icon={appearance.icon}
			label={list.displayName}
			title={list.isShared ? `${list.displayName} (shared)` : list.displayName}
			count={state.counts[selectionKey({ kind: "list", id: list.id })]}
			active={active}
			tinted
			style={tintStyle(appearance.color)}
			onSelect={() => void service.select({ kind: "list", id: list.id })}
			onContextMenu={openMenu}
		/>
	);
}

function AddList(): ReactElement {
	const { service } = useTodoContext();
	const [adding, setAdding] = useState(false);

	if (adding) {
		return (
			<InlineNameInput
				icon="list"
				initial=""
				placeholder="New list"
				onCancel={() => setAdding(false)}
				onSubmit={async (name) => {
					try {
						const list = await service.createList(name);
						setAdding(false);
						await service.select({ kind: "list", id: list.id });
					} catch (error) {
						new Notice(describeError(error));
					}
				}}
			/>
		);
	}

	return (
		<button type="button" className="mstd-add-list" onClick={() => setAdding(true)}>
			<Icon name="plus" />
			<span>Add list</span>
		</button>
	);
}

/** A one-line editor that commits on Enter or blur and cancels on Escape. */
function InlineNameInput(props: {
	icon: string;
	initial: string;
	placeholder: string;
	style?: CSSProperties;
	onSubmit: (name: string) => Promise<void>;
	onCancel: () => void;
}): ReactElement {
	const [value, setValue] = useState(props.initial);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	// Enter disables the field, which blurs it, which would commit a second time.
	const committedRef = useRef(false);

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	async function commit(): Promise<void> {
		if (committedRef.current) return;
		committedRef.current = true;
		const name = value.trim();
		if (!name || name === props.initial) {
			props.onCancel();
			return;
		}
		setBusy(true);
		await props.onSubmit(name);
		setBusy(false);
		committedRef.current = false;
	}

	return (
		<div className="mstd-nav-item is-editing is-tinted" style={props.style}>
			<Icon name={props.icon} className="mstd-nav-icon" />
			<input
				ref={inputRef}
				type="text"
				className="mstd-nav-input"
				value={value}
				disabled={busy}
				placeholder={props.placeholder}
				maxLength={255}
				onChange={(event) => setValue(event.target.value)}
				onBlur={() => void commit()}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void commit();
					} else if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						committedRef.current = true;
						props.onCancel();
					}
				}}
			/>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */

function SyncFooter(): ReactElement {
	const { plugin, service } = useTodoContext();
	const { lastSyncAt, status, error, account } = useTodoState();
	useMinuteTick();

	const syncing = status !== "idle";
	const tone = syncing ? "is-syncing" : error ? "is-error" : lastSyncAt ? "is-ok" : "is-idle";
	const label = syncing ? "Syncing…" : error ? "Sync problem" : lastSyncAt ? "Synced" : "Not synced";
	const detail = syncing ? "Fetching the latest" : lastSyncAt ? formatRelative(lastSyncAt) : "Click to sync";

	return (
		<div className="mstd-sync">
			<button
				type="button"
				className={`mstd-sync-status ${tone}`}
				disabled={syncing}
				title={account ? `Signed in as ${account.username || account.name}. Click to sync now.` : "Sync now"}
				onClick={() => void service.refresh({ force: true, background: true })}
			>
				<span className="mstd-sync-dot" aria-hidden="true" />
				<span className="mstd-sync-text">
					<span className="mstd-sync-label">{label}</span>
					<span className="mstd-sync-detail">{detail}</span>
				</span>
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
	);
}

function formatRelative(timestamp: number): string {
	const seconds = Math.round((Date.now() - timestamp) / 1000);
	if (seconds < 60) return "Just now";
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
