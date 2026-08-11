import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { TaskDetails } from "./TaskDetails";
import { fromGraphDate, formatDueDate, isOverdue, isToday } from "../util/date";
import type { TaskWithList, UpdateTaskInput } from "../types/microsoft-todo";

export interface TaskItemProps {
	task: TaskWithList;
	busy: boolean;
	expanded: boolean;
	showListName: boolean;
	onToggleComplete: () => void;
	onToggleImportant: () => void;
	onRename: (title: string) => Promise<void>;
	onToggleExpanded: () => void;
	onUpdate: (input: UpdateTaskInput) => Promise<void>;
	onDelete: () => Promise<void>;
}

/**
 * One task row, following Microsoft To Do's anatomy: completion circle on the
 * left, title and metadata in the middle, importance star pinned to the right.
 */
export function TaskItem(props: TaskItemProps): JSX.Element {
	const { task, busy, expanded } = props;
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(task.title);
	const inputRef = useRef<HTMLInputElement>(null);

	const completed = task.status === "completed";
	const important = task.importance === "high";
	const due = fromGraphDate(task.dueDateTime);
	const noteText = task.body?.content?.trim() ?? "";

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	// A refresh can rename a task out from under an open editor.
	useEffect(() => {
		if (!editing) setDraft(task.title);
	}, [task.title, editing]);

	function startEditing(): void {
		setDraft(task.title);
		setEditing(true);
	}

	async function commit(): Promise<void> {
		setEditing(false);
		const next = draft.trim();
		if (!next || next === task.title) {
			setDraft(task.title);
			return;
		}
		try {
			await props.onRename(next);
		} catch {
			setDraft(task.title);
		}
	}

	const dueClass = !due || completed ? "" : isOverdue(due) ? " is-overdue" : isToday(due) ? " is-today" : "";

	return (
		<li
			className={`mstd-task${completed ? " is-completed" : ""}${busy ? " is-busy" : ""}${
				expanded ? " is-expanded" : ""
			}`}
		>
			<div className="mstd-task-row">
				<button
					type="button"
					className="mstd-checkbox"
					role="checkbox"
					aria-checked={completed}
					aria-label={completed ? `Reopen ${task.title}` : `Complete ${task.title}`}
					disabled={busy}
					onClick={props.onToggleComplete}
				>
					<Icon name={completed ? "check-circle-2" : "circle"} />
				</button>

				<div className="mstd-task-body">
					{editing ? (
						<input
							ref={inputRef}
							type="text"
							className="mstd-task-title-input"
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onBlur={() => void commit()}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void commit();
								} else if (event.key === "Escape") {
									event.preventDefault();
									setDraft(task.title);
									setEditing(false);
								}
							}}
						/>
					) : (
						<button
							type="button"
							className="mstd-task-title"
							onClick={props.onToggleExpanded}
							onDoubleClick={startEditing}
							title={`${task.title}\n\nClick for details, double-click to rename`}
						>
							{task.title}
						</button>
					)}

					{(due || props.showListName || noteText) && (
						<div className="mstd-task-meta">
							{props.showListName && (
								<span className="mstd-task-list-name" title={task.listName}>
									{task.listName}
								</span>
							)}
							{due && (
								<span className={`mstd-task-due${dueClass}`}>
									<Icon name="calendar" />
									{formatDueDate(due)}
								</span>
							)}
							{noteText && (
								<span className="mstd-task-note-flag" title={noteText.slice(0, 300)}>
									<Icon name="align-left" />
								</span>
							)}
						</div>
					)}
				</div>

				<div className="mstd-task-actions">
					<button
						type="button"
						className="mstd-icon-button mstd-task-edit"
						title="Rename task"
						aria-label={`Rename ${task.title}`}
						disabled={busy}
						onClick={startEditing}
					>
						<Icon name="pencil" />
					</button>

					<button
						type="button"
						className={`mstd-icon-button mstd-task-star${important ? " is-active" : ""}`}
						title={important ? "Remove importance" : "Mark as important"}
						aria-label={important ? `Remove importance from ${task.title}` : `Mark ${task.title} as important`}
						aria-pressed={important}
						disabled={busy}
						onClick={props.onToggleImportant}
					>
						<Icon name="star" />
					</button>
				</div>
			</div>

			{expanded && (
				<TaskDetails
					task={task}
					busy={busy}
					showListName={props.showListName}
					onUpdate={props.onUpdate}
					onDelete={props.onDelete}
					onClose={props.onToggleExpanded}
				/>
			)}
		</li>
	);
}
