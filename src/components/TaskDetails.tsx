import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "./Icon";
import { DueDateControl } from "./DueDateControl";
import { fromGraphDate } from "../util/date";
import type { TaskWithList, UpdateTaskInput } from "../types/microsoft-todo";

export interface TaskDetailsProps {
	task: TaskWithList;
	/** True when the task belongs to a view that spans lists, so we name its list. */
	showListName: boolean;
	busy: boolean;
	onUpdate: (input: UpdateTaskInput) => Promise<void>;
	onDelete: () => Promise<void>;
	onClose: () => void;
}

/**
 * The expanded row body: due date, notes and delete.
 *
 * Rendered inline rather than in a modal because the panel usually lives in a
 * narrow sidebar, where a modal would cover the note the user is working in.
 * Importance is deliberately absent - the star on the row itself owns that.
 */
export function TaskDetails({ task, showListName, busy, onUpdate, onDelete, onClose }: TaskDetailsProps): ReactElement {
	const [notes, setNotes] = useState(task.body?.content ?? "");
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	// Re-sync when the server copy comes back, or when a different task expands.
	useEffect(() => {
		setNotes(task.body?.content ?? "");
	}, [task.id, task.body?.content]);

	const due = fromGraphDate(task.dueDateTime);
	const notesChanged = notes !== (task.body?.content ?? "");

	return (
		<div className="mstd-task-details">
			<div className="mstd-detail-row">
				<DueDateControl
					value={due}
					disabled={busy}
					onChange={(value) => void onUpdate({ dueDate: value })}
					placeholder="Add due date"
				/>
				{showListName && (
					<span className="mstd-chip" title={task.listName}>
						{task.listName}
					</span>
				)}
			</div>

			<div className="mstd-detail-row mstd-detail-row--stacked">
				<textarea
					id={`mstd-notes-${task.id}`}
					className="mstd-notes-input"
					rows={3}
					value={notes}
					disabled={busy}
					placeholder="Add a note"
					onChange={(event) => setNotes(event.target.value)}
					onBlur={() => {
						if (notesChanged) void onUpdate({ body: notes });
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							setNotes(task.body?.content ?? "");
							(event.target as HTMLTextAreaElement).blur();
						}
					}}
				/>
				{notesChanged && <div className="mstd-detail-hint">Click outside the note to save it.</div>}
			</div>

			<div className="mstd-detail-footer">
				{confirmingDelete ? (
					<>
						<span className="mstd-detail-hint">Delete this task?</span>
						<span className="mstd-detail-actions">
							<button
								type="button"
								className="mstd-text-button mod-warning"
								disabled={busy}
								onClick={() => void onDelete()}
							>
								Delete
							</button>
							<button type="button" className="mstd-text-button" onClick={() => setConfirmingDelete(false)}>
								Cancel
							</button>
						</span>
					</>
				) : (
					<>
						<button type="button" className="mstd-text-button" onClick={onClose}>
							Close
						</button>
						<button
							type="button"
							className="mstd-icon-button mstd-detail-delete"
							title="Delete task"
							aria-label="Delete task"
							disabled={busy}
							onClick={() => setConfirmingDelete(true)}
						>
							<Icon name="trash-2" />
						</button>
					</>
				)}
			</div>
		</div>
	);
}
