import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { Menu, Notice } from "obsidian";
import { Icon } from "./Icon";
import { DueDateControl } from "./DueDateControl";
import { useTodoContext, usePreferences, useTodoState } from "./PluginContext";
import { usePanelState } from "./PanelState";
import {
	copyTaskLink,
	deleteTaskWithConfirm,
	moveTask,
	moveTaskWithPicker,
	run,
	taskWebUrl,
} from "./taskActions";
import { describeError } from "../errors";
import { colorForKey, resolveListAppearance, tintStyle } from "../util/appearance";
import { fromGraphDate, fromGraphInstant, formatDueDate } from "../util/date";
import {
	buildNoteLinkedResource,
	findSourceNotePath,
	linkedNotePath,
	openSourceNote,
	resolveNote,
} from "../util/note-reference";
import { NoteSuggestModal } from "../views/modals";
import type { ChecklistItem, LinkedResource, TaskWithList } from "../types/microsoft-todo";

/**
 * Right column: everything about one task - title, due date, list, tags,
 * notes, linked Obsidian notes, subtasks and quick actions.
 *
 * Edits save as you go, the way To Do's own detail pane does: text fields on
 * blur, everything else on click.
 */
export function DetailPane({ task }: { task: TaskWithList | undefined }): ReactElement {
	const panel = usePanelState();
	const overlay = panel.layout !== "wide";

	return (
		<aside className={`mstd-detail${overlay ? " is-overlay" : ""}`} aria-label="Task details">
			<DetailHeader task={task} />
			{task ? (
				<div className="mstd-detail-scroll" key={task.id}>
					{task.source === "todo" ? <TodoDetails task={task} /> : <PlannerDetails task={task} />}
				</div>
			) : (
				<div className="mstd-empty mstd-detail-empty">
					<Icon name="mouse-pointer-click" className="mstd-empty-icon" />
					<p>Select a task to see its details, subtasks and linked notes.</p>
				</div>
			)}
		</aside>
	);
}

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

function DetailHeader({ task }: { task: TaskWithList | undefined }): ReactElement {
	const { plugin, service } = useTodoContext();
	const panel = usePanelState();

	function openMoreMenu(event: MouseEvent): void {
		if (!task) return;
		const readOnly = task.source !== "todo";
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Move to list…")
				.setIcon("folder-input")
				.setDisabled(readOnly)
				.onClick(() => {
					void moveTaskWithPicker(plugin, service, task).then((id) => {
						if (id) panel.selectTask(id);
					});
				})
		);
		menu.addItem((item) => item.setTitle("Copy link").setIcon("link").onClick(() => void copyTaskLink(task)));
		menu.addItem((item) =>
			item
				.setTitle("Open in Microsoft To Do")
				.setIcon("external-link")
				.onClick(() => window.open(taskWebUrl(task), "_blank"))
		);
		if (!readOnly) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle("Delete task")
					.setIcon("trash-2")
					.setWarning(true)
					.onClick(() => {
						void deleteTaskWithConfirm(plugin, service, task).then((deleted) => {
							if (deleted) panel.selectTask(null);
						});
					})
			);
		}
		menu.showAtMouseEvent(event);
	}

	return (
		<div className="mstd-detail-header">
			<span className="mstd-detail-header-title">Details</span>

			<span className="mstd-spacer" />

			<button
				type="button"
				className="mstd-icon-button"
				title="More actions"
				aria-label="More actions"
				disabled={!task}
				onClick={(event) => openMoreMenu(event.nativeEvent)}
			>
				<Icon name="more-horizontal" />
			</button>

			<button
				type="button"
				className="mstd-icon-button"
				title="Close details"
				aria-label="Close details"
				disabled={!task && panel.layout === "wide"}
				onClick={() => panel.selectTask(null)}
			>
				<Icon name="x" />
			</button>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* To Do task                                                                 */
/* -------------------------------------------------------------------------- */

function TodoDetails({ task }: { task: TaskWithList }): ReactElement {
	const { plugin, service } = useTodoContext();
	const state = useTodoState();
	const busy = state.busyTaskIds.includes(task.id);
	const completed = task.status === "completed";

	// Subtasks and links normally arrive with the task; fetch them if they didn't.
	useEffect(() => {
		if (task.checklistItems === undefined || task.linkedResources === undefined) {
			service.loadExtras(task).catch((error) => new Notice(describeError(error)));
		}
	}, [task.id, task.checklistItems === undefined, task.linkedResources === undefined]);

	return (
		<>
			<TitleBlock task={task} busy={busy} />

			<div className="mstd-props">
				<PropRow icon="calendar">
					<DueDateControl
						variant="inline"
						value={fromGraphDate(task.dueDateTime)}
						disabled={busy}
						placeholder="Add due date"
						onChange={(value) => void run(() => service.updateTask(task, { dueDate: value }))}
					/>
				</PropRow>

				<PropRow icon="list">
					<ListPicker task={task} busy={busy} />
				</PropRow>

				<PropRow icon="tag">
					<TagEditor task={task} busy={busy} />
				</PropRow>

				<PropRow icon="align-left" alignTop>
					<NotesEditor task={task} busy={busy} />
				</PropRow>
			</div>

			<LinkedNotes task={task} />
			<Subtasks task={task} />

			<section className="mstd-section">
				<h3 className="mstd-section-title">Quick actions</h3>
				<div className="mstd-quick-actions">
					<QuickAction
						icon={completed ? "rotate-ccw" : "check"}
						label={completed ? "Mark not done" : "Mark complete"}
						disabled={busy}
						onClick={() => void run(() => service.setCompleted(task, !completed))}
					/>
					<QuickAction icon="file-plus" label="Add to note" onClick={() => void plugin.insertTaskLinkIntoNote(task)} />
					<QuickAction icon="external-link" label="Open in To Do" onClick={() => window.open(taskWebUrl(task), "_blank")} />
				</div>
			</section>

			<DetailFooter task={task} />
		</>
	);
}

function TitleBlock({ task, busy }: { task: TaskWithList; busy: boolean }): ReactElement {
	const { service } = useTodoContext();
	const [draft, setDraft] = useState(task.title);
	const [focused, setFocused] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const completed = task.status === "completed";
	const important = task.importance === "high";
	const readOnly = task.source !== "todo";

	// A refresh can rename the task under us; don't clobber an edit in progress.
	useEffect(() => {
		if (!focused) setDraft(task.title);
	}, [task.title, focused]);

	useAutoHeight(ref, draft);

	function commit(): void {
		const next = draft.replace(/\s+/g, " ").trim();
		if (!next || next === task.title) {
			setDraft(task.title);
			return;
		}
		void run(() => service.renameTask(task, next)).then((ok) => {
			if (!ok) setDraft(task.title);
		});
	}

	return (
		<div className={`mstd-title-block${completed ? " is-completed" : ""}`}>
			<button
				type="button"
				className="mstd-check mstd-check--large"
				role="checkbox"
				aria-checked={completed}
				aria-label={completed ? "Mark as not completed" : "Mark as completed"}
				disabled={busy || readOnly}
				onClick={() => void run(() => service.setCompleted(task, !completed))}
			>
				<Icon name="check" className="mstd-check-mark" />
			</button>

			{readOnly ? (
				<h2 className="mstd-title-text">{task.title}</h2>
			) : (
				<textarea
					ref={ref}
					className="mstd-title-input"
					rows={1}
					value={draft}
					maxLength={255}
					aria-label="Task title"
					onFocus={() => setFocused(true)}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={() => {
						setFocused(false);
						commit();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.blur();
						} else if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setDraft(task.title);
							// Blur after the revert has rendered, so commit sees no change.
							const target = event.currentTarget;
							window.setTimeout(() => target.blur(), 0);
						}
					}}
				/>
			)}

			<button
				type="button"
				className={`mstd-star mstd-star--large${important ? " is-active" : ""}`}
				aria-pressed={important}
				aria-label={important ? "Remove importance" : "Mark as important"}
				title={important ? "Remove importance" : "Mark as important"}
				disabled={busy || readOnly}
				onClick={() => void run(() => service.setImportance(task, important ? "normal" : "high"))}
			>
				<Icon name="star" />
			</button>
		</div>
	);
}

function PropRow({ icon, alignTop, children }: { icon: string; alignTop?: boolean; children: ReactElement }): ReactElement {
	return (
		<div className={`mstd-prop${alignTop ? " is-top" : ""}`}>
			<Icon name={icon} className="mstd-prop-icon" />
			<div className="mstd-prop-body">{children}</div>
		</div>
	);
}

/** The list name as a dropdown; picking another list moves the task there. */
function ListPicker({ task, busy }: { task: TaskWithList; busy: boolean }): ReactElement {
	const { service } = useTodoContext();
	const state = useTodoState();
	const panel = usePanelState();
	const preferences = usePreferences();

	const list = state.lists.find((entry) => entry.id === task.listId);
	const appearance = list ? resolveListAppearance(list, preferences.listAppearance) : null;

	function openMenu(event: MouseEvent): void {
		const menu = new Menu();
		for (const candidate of state.lists) {
			if (candidate.wellknownListName === "flaggedEmails") continue;
			menu.addItem((item) =>
				item
					.setTitle(candidate.displayName)
					.setIcon(resolveListAppearance(candidate, preferences.listAppearance).icon)
					.setChecked(candidate.id === task.listId)
					.onClick(() => {
						if (candidate.id === task.listId) return;
						void moveTask(service, task, candidate.id).then((id) => {
							if (id) panel.selectTask(id);
						});
					})
			);
		}
		menu.showAtMouseEvent(event);
	}

	return (
		<button
			type="button"
			className="mstd-inline-select"
			disabled={busy || list?.wellknownListName === "flaggedEmails"}
			title="Move to another list"
			style={appearance ? tintStyle(appearance.color) : undefined}
			onClick={(event) => openMenu(event.nativeEvent)}
		>
			<span>{task.listName}</span>
			<Icon name="chevron-down" />
		</button>
	);
}

/**
 * Tags are To Do "categories". Graph accepts any string; Outlook shows the ones
 * it doesn't know as uncoloured categories, so nothing is lost either way.
 */
function TagEditor({ task, busy }: { task: TaskWithList; busy: boolean }): ReactElement {
	const { service } = useTodoContext();
	const state = useTodoState();
	const [draft, setDraft] = useState("");
	const tags = task.categories ?? [];

	const known = useMemo(() => {
		const all = new Set<string>();
		for (const candidate of state.allTasks) for (const tag of candidate.categories ?? []) all.add(tag);
		for (const tag of tags) all.delete(tag);
		return [...all].sort((a, b) => a.localeCompare(b));
	}, [state.allTasks, tags]);

	function add(value: string): void {
		const tag = value.replace(/,/g, " ").trim();
		setDraft("");
		if (!tag || tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
		void run(() => service.setCategories(task, [...tags, tag]));
	}

	function remove(tag: string): void {
		void run(() => service.setCategories(task, tags.filter((existing) => existing !== tag)));
	}

	const datalistId = `mstd-tags-${task.id}`;

	return (
		<div className="mstd-tags">
			{tags.map((tag) => (
				<span key={tag} className="mstd-tag mstd-tag--removable" style={tintStyle(colorForKey(tag))}>
					{tag}
					<button
						type="button"
						className="mstd-tag-remove"
						aria-label={`Remove tag ${tag}`}
						disabled={busy}
						onClick={() => remove(tag)}
					>
						<Icon name="x" />
					</button>
				</span>
			))}
			<input
				type="text"
				className="mstd-tag-input"
				placeholder="Add tag…"
				value={draft}
				disabled={busy}
				list={datalistId}
				onChange={(event) => {
					const value = event.target.value;
					if (value.endsWith(",")) add(value);
					else setDraft(value);
				}}
				onBlur={() => {
					if (draft.trim()) add(draft);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						add(draft);
					} else if (event.key === "Backspace" && !draft && tags.length > 0) {
						remove(tags[tags.length - 1]);
					} else if (event.key === "Escape") {
						event.stopPropagation();
						setDraft("");
						event.currentTarget.blur();
					}
				}}
			/>
			<datalist id={datalistId}>
				{known.map((tag) => (
					<option key={tag} value={tag} />
				))}
			</datalist>
		</div>
	);
}

function NotesEditor({ task, busy }: { task: TaskWithList; busy: boolean }): ReactElement {
	const { service } = useTodoContext();
	const saved = task.body?.content ?? "";
	const [notes, setNotes] = useState(saved);
	const [focused, setFocused] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!focused) setNotes(saved);
	}, [saved, focused]);

	useAutoHeight(ref, notes);

	return (
		<textarea
			ref={ref}
			className="mstd-notes"
			rows={2}
			value={notes}
			disabled={busy}
			placeholder="Add notes"
			aria-label="Notes"
			onFocus={() => setFocused(true)}
			onChange={(event) => setNotes(event.target.value)}
			onBlur={() => {
				setFocused(false);
				if (notes !== saved) void run(() => service.updateTask(task, { body: notes }));
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setNotes(saved);
					const target = event.currentTarget;
					window.setTimeout(() => target.blur(), 0);
				}
			}}
		/>
	);
}

/* -------------------------------------------------------------------------- */
/* Linked notes                                                               */
/* -------------------------------------------------------------------------- */

interface LinkedItem {
	key: string;
	/** Vault path, for Obsidian notes. */
	path: string | null;
	resource: LinkedResource | null;
	/** Found in the task's notes rather than recorded as a linked resource. */
	fromNotes: boolean;
}

function LinkedNotes({ task }: { task: TaskWithList }): ReactElement {
	const { app, plugin, service } = useTodoContext();
	const [open, setOpen] = useState(true);

	const items = useMemo<LinkedItem[]>(() => {
		const result: LinkedItem[] = [];
		const seen = new Set<string>();
		for (const resource of task.linkedResources ?? []) {
			const path = linkedNotePath(resource);
			if (path) seen.add(path);
			result.push({ key: resource.id, path, resource, fromNotes: false });
		}
		// Tasks created before linked resources existed carry the note in their text.
		const legacy = findSourceNotePath(task.body?.content);
		if (legacy && !seen.has(legacy)) result.push({ key: `notes:${legacy}`, path: legacy, resource: null, fromNotes: true });
		return result;
	}, [task.linkedResources, task.body?.content]);

	function addLink(): void {
		const linked = new Set(items.map((item) => item.path).filter((path): path is string => !!path));
		new NoteSuggestModal(app, plugin.getRecentNote(), linked, (file) => {
			void run(() => service.addLinkedResource(task, buildNoteLinkedResource(app.vault.getName(), file)));
		}).open();
	}

	return (
		<section className="mstd-section">
			<div className="mstd-section-header">
				<button
					type="button"
					className="mstd-section-toggle"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					<Icon name={open ? "chevron-down" : "chevron-right"} />
					<span className="mstd-section-title">Linked notes</span>
					{items.length > 0 && <span className="mstd-count">{items.length}</span>}
				</button>
				<button type="button" className="mstd-icon-button" title="Link a note" aria-label="Link a note" onClick={addLink}>
					<Icon name="plus" />
				</button>
			</div>

			{open &&
				(items.length > 0 ? (
					<ul className="mstd-card-list">
						{items.map((item) => (
							<LinkedItemRow key={item.key} task={task} item={item} />
						))}
					</ul>
				) : (
					<button type="button" className="mstd-add-row" onClick={addLink}>
						<Icon name="file-plus" />
						<span>Link a note from this vault</span>
					</button>
				))}
		</section>
	);
}

function LinkedItemRow({ task, item }: { task: TaskWithList; item: LinkedItem }): ReactElement {
	const { app, service } = useTodoContext();
	const file = item.path ? resolveNote(app, item.path) : null;

	const title = file?.basename ?? item.resource?.displayName ?? item.path ?? item.resource?.webUrl ?? "Linked item";
	const subtitle = item.path
		? file
			? noteSummary(app, file.path) ?? (file.parent && !file.parent.isRoot() ? file.parent.path : "Vault root")
			: "Not found in this vault"
		: item.resource?.applicationName ?? "External link";

	function open(newTab: boolean): void {
		if (item.path) void openSourceNote(app, item.path, newTab);
		else if (item.resource?.webUrl) window.open(item.resource.webUrl, "_blank");
	}

	return (
		<li className={`mstd-card${item.path && !file ? " is-missing" : ""}`}>
			<button type="button" className="mstd-card-main" onClick={() => open(false)} title={item.path ?? item.resource?.webUrl ?? ""}>
				<Icon name={item.path ? "file-text" : "globe"} className="mstd-card-icon" />
				<span className="mstd-card-text">
					<span className="mstd-card-title">{title}</span>
					<span className="mstd-card-subtitle">
						{subtitle}
						{item.fromNotes && " · from task notes"}
					</span>
				</span>
			</button>
			<div className="mstd-card-actions">
				<button
					type="button"
					className="mstd-icon-button"
					title={item.path ? "Open in new tab" : "Open link"}
					aria-label={item.path ? "Open in new tab" : "Open link"}
					onClick={() => open(true)}
				>
					<Icon name="external-link" />
				</button>
				{item.resource && (
					<button
						type="button"
						className="mstd-icon-button mstd-card-remove"
						title="Unlink"
						aria-label={`Unlink ${title}`}
						onClick={() => void run(() => service.deleteLinkedResource(task, item.resource!.id))}
					>
						<Icon name="x" />
					</button>
				)}
			</div>
		</li>
	);
}

/** A note's own description, if its frontmatter has one. */
function noteSummary(app: ReturnType<typeof useTodoContext>["app"], path: string): string | null {
	const frontmatter = app.metadataCache.getCache(path)?.frontmatter;
	const value = frontmatter?.description ?? frontmatter?.summary;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Subtasks                                                                   */
/* -------------------------------------------------------------------------- */

function Subtasks({ task }: { task: TaskWithList }): ReactElement {
	const { service } = useTodoContext();
	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const items = task.checklistItems ?? [];
	const done = items.filter((item) => item.isChecked).length;
	const loading = task.checklistItems === undefined;

	async function add(): Promise<void> {
		const name = draft.trim();
		if (!name || adding) return;
		setAdding(true);
		const ok = await run(() => service.addChecklistItem(task, name));
		setAdding(false);
		if (ok) setDraft("");
	}

	return (
		<section className="mstd-section mstd-subtasks">
			<div className="mstd-section-header">
				<h3 className="mstd-section-title">Subtasks</h3>
				{items.length > 0 && (
					<>
						<span className="mstd-count">
							{done} / {items.length}
						</span>
						<span
							className="mstd-progress"
							role="progressbar"
							aria-valuemin={0}
							aria-valuemax={items.length}
							aria-valuenow={done}
						>
							<span className="mstd-progress-fill" style={{ width: `${(done / items.length) * 100}%` }} />
						</span>
					</>
				)}
			</div>

			{loading ? (
				<div className="mstd-subtasks-loading">
					<span className="mstd-spinner" />
				</div>
			) : (
				<ul className="mstd-subtask-list">
					{items.map((item) => (
						<SubtaskRow key={item.id} task={task} item={item} />
					))}
				</ul>
			)}

			<div className="mstd-subtask mstd-subtask--new">
				<Icon name="plus" className="mstd-subtask-add-icon" />
				<input
					type="text"
					className="mstd-subtask-input"
					placeholder="Add subtask"
					value={draft}
					disabled={adding || loading}
					maxLength={255}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void add();
						} else if (event.key === "Escape") {
							event.stopPropagation();
							setDraft("");
							event.currentTarget.blur();
						}
					}}
					onBlur={() => void add()}
				/>
			</div>
		</section>
	);
}

function SubtaskRow({ task, item }: { task: TaskWithList; item: ChecklistItem }): ReactElement {
	const { service } = useTodoContext();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(item.displayName);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) setDraft(item.displayName);
	}, [item.displayName, editing]);

	useEffect(() => {
		if (editing) inputRef.current?.focus();
	}, [editing]);

	function commit(): void {
		setEditing(false);
		const name = draft.trim();
		if (!name || name === item.displayName) {
			setDraft(item.displayName);
			return;
		}
		void run(() => service.updateChecklistItem(task, item.id, { displayName: name }));
	}

	return (
		<li className={`mstd-subtask${item.isChecked ? " is-checked" : ""}`}>
			<button
				type="button"
				className="mstd-box"
				role="checkbox"
				aria-checked={item.isChecked}
				aria-label={item.isChecked ? `Uncheck ${item.displayName}` : `Check ${item.displayName}`}
				onClick={() => void run(() => service.updateChecklistItem(task, item.id, { isChecked: !item.isChecked }))}
			>
				<Icon name="check" />
			</button>

			{editing ? (
				<input
					ref={inputRef}
					type="text"
					className="mstd-subtask-input"
					value={draft}
					maxLength={255}
					onChange={(event) => setDraft(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							setDraft(item.displayName);
							setEditing(false);
						}
					}}
				/>
			) : (
				<button type="button" className="mstd-subtask-name" title="Click to rename" onClick={() => setEditing(true)}>
					{item.displayName}
				</button>
			)}

			<button
				type="button"
				className="mstd-icon-button mstd-subtask-delete"
				aria-label={`Delete subtask ${item.displayName}`}
				title="Delete subtask"
				onClick={() => void run(() => service.deleteChecklistItem(task, item.id))}
			>
				<Icon name="x" />
			</button>
		</li>
	);
}

/* -------------------------------------------------------------------------- */
/* Footer and quick actions                                                   */
/* -------------------------------------------------------------------------- */

function QuickAction(props: { icon: string; label: string; disabled?: boolean; onClick: () => void }): ReactElement {
	return (
		<button type="button" className="mstd-quick-action" disabled={props.disabled} onClick={props.onClick}>
			<Icon name={props.icon} />
			<span>{props.label}</span>
		</button>
	);
}

function DetailFooter({ task }: { task: TaskWithList }): ReactElement {
	const { plugin, service } = useTodoContext();
	const panel = usePanelState();
	const created = new Date(task.createdDateTime);
	const completedAt = fromGraphInstant(task.completedDateTime);

	const text =
		task.status === "completed" && completedAt
			? `Completed ${completedAt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
			: Number.isNaN(created.getTime())
				? ""
				: `Created ${created.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;

	return (
		<div className="mstd-detail-footer">
			<span>{text}</span>
			<button
				type="button"
				className="mstd-icon-button mstd-danger"
				title="Delete task"
				aria-label="Delete task"
				onClick={() => {
					void deleteTaskWithConfirm(plugin, service, task).then((deleted) => {
						if (deleted) panel.selectTask(null);
					});
				}}
			>
				<Icon name="trash-2" />
			</button>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Planner task                                                               */
/* -------------------------------------------------------------------------- */

/** Planner tasks are shown, not edited: Planner writes need ETags and its own shape. */
function PlannerDetails({ task }: { task: TaskWithList }): ReactElement {
	const due = fromGraphDate(task.dueDateTime);
	const status =
		task.status === "completed" ? "Completed" : task.status === "inProgress" ? "In progress" : "Not started";

	return (
		<>
			<TitleBlock task={task} busy={false} />

			<div className="mstd-props">
				<PropRow icon="calendar">
					<span className="mstd-prop-text">{due ? `Due ${formatDueDate(due)}` : "No due date"}</span>
				</PropRow>
				<PropRow icon="clipboard-list">
					<span className="mstd-prop-text">{task.listName}</span>
				</PropRow>
				<PropRow icon="activity">
					<span className="mstd-prop-text">{status}</span>
				</PropRow>
			</div>

			<div className="mstd-callout">
				<Icon name="info" />
				<span>Assigned to you in Planner. Planner tasks are read-only here; open them in To Do to make changes.</span>
			</div>

			<section className="mstd-section">
				<h3 className="mstd-section-title">Quick actions</h3>
				<div className="mstd-quick-actions">
					<QuickAction icon="link" label="Copy link" onClick={() => void copyTaskLink(task)} />
					<QuickAction icon="external-link" label="Open in To Do" onClick={() => window.open(taskWebUrl(task), "_blank")} />
				</div>
			</section>
		</>
	);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Grows a textarea with its content instead of scrolling inside it. Re-measures
 * when its width changes too - the pane slides in and resizes with the leaf, and
 * a measurement taken mid-layout would clip a wrapped title to its first line.
 */
function useAutoHeight(ref: RefObject<HTMLTextAreaElement>, value: string): void {
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;

		const fit = (): void => {
			element.style.height = "auto";
			// scrollHeight excludes borders; add them back so nothing clips.
			element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
		};
		fit();

		let lastWidth = element.clientWidth;
		const observer = new ResizeObserver(() => {
			if (element.clientWidth === lastWidth) return;
			lastWidth = element.clientWidth;
			fit();
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, value]);
}
