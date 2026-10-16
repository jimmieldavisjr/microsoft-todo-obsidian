import { useEffect, useRef, useState, type ReactElement } from "react";
import { Icon } from "./Icon";
import { useTodoContext } from "./PluginContext";
import { usePanelState } from "./PanelState";
import { run, showTaskMenu } from "./taskActions";
import { colorForKey, tintStyle, type PaletteColor } from "../util/appearance";
import { fromGraphDate, formatDueDate, isOverdue, isToday } from "../util/date";
import type { TaskWithList } from "../types/microsoft-todo";

/** Long enough to see the tick land before the row leaves an open-tasks view. */
const COMPLETE_ANIMATION_MS = 380;

export interface TaskRowProps {
	task: TaskWithList;
	busy: boolean;
	selected: boolean;
	/** Views that span lists name each task's list as its first tag. */
	showListName: boolean;
	listColor: PaletteColor | undefined;
}

/**
 * One task: completion circle, title over its tags, due date, importance star.
 * Selecting a row opens it in the detail column; right-click for everything else.
 */
export function TaskRow({ task, busy, selected, showListName, listColor }: TaskRowProps): ReactElement {
	const { plugin, service } = useTodoContext();
	const panel = usePanelState();
	const [completing, setCompleting] = useState(false);
	const timer = useRef<number | null>(null);

	useEffect(() => () => {
		if (timer.current !== null) window.clearTimeout(timer.current);
	}, []);

	const readOnly = task.source !== "todo";
	const completed = task.status === "completed";
	const important = task.importance === "high";
	const due = fromGraphDate(task.dueDateTime);
	const dueTone = !due || completed ? "" : isOverdue(due) ? " is-overdue" : isToday(due) ? " is-today" : "";

	const subtasks = task.checklistItems ?? [];
	const subtasksDone = subtasks.filter((item) => item.isChecked).length;
	const linkCount = task.linkedResources?.length ?? 0;
	const hasNotes = (task.body?.content ?? "").trim().length > 0;

	function toggleComplete(): void {
		if (completed) {
			void run(() => service.setCompleted(task, false));
			return;
		}
		setCompleting(true);
		timer.current = window.setTimeout(() => {
			timer.current = null;
			void run(() => service.setCompleted(task, true)).then(() => setCompleting(false));
		}, COMPLETE_ANIMATION_MS);
	}

	const checked = completed || completing;

	return (
		<li
			className={[
				"mstd-row",
				selected ? "is-selected" : "",
				checked ? "is-completed" : "",
				completing ? "is-completing" : "",
				busy ? "is-busy" : "",
			]
				.filter(Boolean)
				.join(" ")}
			onContextMenu={(event) => {
				event.preventDefault();
				showTaskMenu(event.nativeEvent, plugin, service, task, panel.selectTask);
			}}
		>
			<button
				type="button"
				className="mstd-check"
				role="checkbox"
				aria-checked={checked}
				aria-label={completed ? `Mark "${task.title}" as not completed` : `Complete "${task.title}"`}
				disabled={busy || readOnly || completing}
				title={readOnly ? "Planner tasks are read-only here" : undefined}
				onClick={toggleComplete}
			>
				<Icon name="check" className="mstd-check-mark" />
			</button>

			<button
				type="button"
				className="mstd-row-main"
				aria-pressed={selected}
				onClick={() => panel.selectTask(selected ? null : task.id)}
			>
				<span className="mstd-row-text">
					<span className="mstd-row-title">{task.title}</span>

					{(showListName || (task.categories?.length ?? 0) > 0 || subtasks.length > 0 || hasNotes || linkCount > 0) && (
						<span className="mstd-row-meta">
							{showListName && (
								<span className="mstd-tag mstd-tag--list" style={listColor ? tintStyle(listColor) : undefined}>
									<span className="mstd-tag-dot" aria-hidden="true" />
									{task.listName}
								</span>
							)}
							{(task.categories ?? []).map((category) => (
								<span key={category} className="mstd-tag" style={tintStyle(colorForKey(category))}>
									{category}
								</span>
							))}
							{subtasks.length > 0 && (
								<span
									className={`mstd-row-indicator${subtasksDone === subtasks.length ? " is-done" : ""}`}
									title={`${subtasksDone} of ${subtasks.length} subtasks done`}
								>
									<Icon name="list-checks" />
									{subtasksDone}/{subtasks.length}
								</span>
							)}
							{linkCount > 0 && (
								<span className="mstd-row-indicator" title={`${linkCount} linked item${linkCount === 1 ? "" : "s"}`}>
									<Icon name="link" />
									{linkCount}
								</span>
							)}
							{hasNotes && (
								<span className="mstd-row-indicator" title="Has notes">
									<Icon name="sticky-note" />
								</span>
							)}
						</span>
					)}
				</span>

				{due && (
					<span className={`mstd-row-due${dueTone}`}>
						<Icon name="calendar" />
						{formatDueDate(due)}
					</span>
				)}
			</button>

			<button
				type="button"
				className={`mstd-star${important ? " is-active" : ""}`}
				aria-pressed={important}
				aria-label={important ? `Remove importance from "${task.title}"` : `Mark "${task.title}" as important`}
				title={important ? "Remove importance" : "Mark as important"}
				disabled={busy || readOnly}
				onClick={() => void run(() => service.setImportance(task, important ? "normal" : "high"))}
			>
				<Icon name="star" />
			</button>
		</li>
	);
}
