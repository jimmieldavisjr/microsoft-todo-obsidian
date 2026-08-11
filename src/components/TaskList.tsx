import { useMemo, useState } from "react";
import { Notice } from "obsidian";
import { Icon } from "./Icon";
import { TaskItem } from "./TaskItem";
import { useTodoContext } from "./PluginContext";
import { describeError } from "../errors";
import type { TaskWithList, UpdateTaskInput } from "../types/microsoft-todo";

export interface TaskListProps {
	tasks: TaskWithList[];
	busyTaskIds: string[];
	/** Smart views mix lists together, so each row names the list it came from. */
	showListNames: boolean;
	emptyMessage: string;
	loading: boolean;
}

export function TaskList({ tasks, busyTaskIds, showListNames, emptyMessage, loading }: TaskListProps): JSX.Element {
	const { service } = useTodoContext();
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [showCompleted, setShowCompleted] = useState(false);

	const busy = useMemo(() => new Set(busyTaskIds), [busyTaskIds]);
	const { open, completed } = useMemo(() => {
		const openTasks: TaskWithList[] = [];
		const completedTasks: TaskWithList[] = [];
		for (const task of tasks) {
			(task.status === "completed" ? completedTasks : openTasks).push(task);
		}
		return { open: openTasks, completed: completedTasks };
	}, [tasks]);

	/**
	 * Surfaces a failed mutation as a Notice and reports whether it succeeded.
	 * The service has already rolled the optimistic update back by this point.
	 */
	async function run(action: () => Promise<void>): Promise<boolean> {
		try {
			await action();
			return true;
		} catch (error) {
			new Notice(describeError(error));
			return false;
		}
	}

	function renderTask(task: TaskWithList): JSX.Element {
		return (
			<TaskItem
				key={task.id}
				task={task}
				busy={busy.has(task.id)}
				expanded={expandedId === task.id}
				showListName={showListNames}
				onToggleComplete={() => {
					void run(() => service.setCompleted(task, task.status !== "completed"));
				}}
				onToggleImportant={() => {
					void run(() =>
						service.updateTask(task, { importance: task.importance === "high" ? "normal" : "high" })
					);
				}}
				onRename={async (title: string) => {
					// TaskItem restores its draft when this rejects.
					if (!(await run(() => service.renameTask(task, title)))) {
						throw new Error("rename failed");
					}
				}}
				onToggleExpanded={() => setExpandedId(expandedId === task.id ? null : task.id)}
				onUpdate={async (input: UpdateTaskInput) => {
					await run(() => service.updateTask(task, input));
				}}
				onDelete={async () => {
					if (await run(() => service.deleteTask(task))) setExpandedId(null);
				}}
			/>
		);
	}

	if (open.length === 0 && completed.length === 0) {
		return (
			<div className="mstd-empty">
				{loading ? <span className="mstd-spinner" /> : <Icon name="check-circle-2" className="mstd-empty-icon" />}
				<p>{loading ? "Loading tasks…" : emptyMessage}</p>
			</div>
		);
	}

	return (
		<div className="mstd-task-list">
			<ul className="mstd-tasks">{open.map(renderTask)}</ul>

			{completed.length > 0 && (
				<div className="mstd-completed">
					<button
						type="button"
						className="mstd-completed-toggle"
						aria-expanded={showCompleted}
						onClick={() => setShowCompleted(!showCompleted)}
					>
						<Icon name={showCompleted ? "chevron-down" : "chevron-right"} />
						<span>Completed</span>
						<span className="mstd-count">{completed.length}</span>
					</button>
					{showCompleted && <ul className="mstd-tasks">{completed.map(renderTask)}</ul>}
				</div>
			)}
		</div>
	);
}
