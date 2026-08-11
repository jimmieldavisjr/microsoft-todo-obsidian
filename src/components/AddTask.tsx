import { useEffect, useRef, useState, type ReactElement } from "react";
import { Icon } from "./Icon";
import { DueDateControl } from "./DueDateControl";
import type { CreateTaskInput, Importance, TodoTaskList } from "../types/microsoft-todo";

export interface AddTaskProps {
	lists: TodoTaskList[];
	/** Which list a new task goes to. `null` when there are no lists yet. */
	targetListId: string | null;
	onChangeTargetList: (listId: string) => void;
	/** Shown when the current view spans several lists, so the target is ambiguous. */
	showListPicker: boolean;
	/**
	 * Pre-applied so a task created inside a smart view actually lands in it -
	 * My Day defaults to a due date of today, Important to high importance.
	 */
	defaultDueDate: Date | null;
	defaultImportance: Importance;
	onCreate: (input: CreateTaskInput, listId: string) => Promise<void>;
}

/**
 * The composer, laid out the way Microsoft To Do's is: a title field, and a
 * toolbar of labelled options that appears once the field is in use, with the
 * commit button anchored to its right.
 */
export function AddTask(props: AddTaskProps): ReactElement {
	const { defaultDueDate, defaultImportance, targetListId } = props;

	const [title, setTitle] = useState("");
	const [dueDate, setDueDate] = useState<Date | null>(defaultDueDate);
	const [importance, setImportance] = useState<Importance>(defaultImportance);
	const [active, setActive] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	// Switching views changes what a "plain" new task should look like.
	useEffect(() => {
		setDueDate(defaultDueDate);
		setImportance(defaultImportance);
	}, [defaultDueDate?.getTime(), defaultImportance]);

	const hasTitle = title.trim().length > 0;
	const canSubmit = hasTitle && targetListId !== null && !submitting;
	const showToolbar = active || hasTitle;

	function reset(): void {
		setTitle("");
		setDueDate(defaultDueDate);
		setImportance(defaultImportance);
	}

	async function submit(): Promise<void> {
		if (!canSubmit || targetListId === null) return;

		setSubmitting(true);
		try {
			await props.onCreate(
				{
					title: title.trim(),
					dueDate,
					importance: importance === "normal" ? undefined : importance,
				},
				targetListId
			);
			// Only clear on success, so a failed create doesn't lose the user's typing.
			reset();
			inputRef.current?.focus();
		} catch {
			// The panel surfaces the error; keep the draft on screen.
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div
			className={`mstd-composer${showToolbar ? " is-active" : ""}`}
			// Focus is tracked on the wrapper, not the input: clicking a toolbar
			// button blurs the field, and a naive onBlur would collapse the toolbar
			// out from under the click.
			onFocus={() => setActive(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
			}}
		>
			<div className="mstd-composer-main">
				<span className="mstd-composer-bullet" aria-hidden="true">
					<Icon name={hasTitle ? "circle" : "plus"} />
				</span>
				<input
					ref={inputRef}
					type="text"
					className="mstd-composer-input"
					placeholder={targetListId === null ? "No lists available" : "Add a task"}
					value={title}
					disabled={targetListId === null}
					onChange={(event) => setTitle(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							void submit();
						} else if (event.key === "Escape") {
							event.preventDefault();
							reset();
							inputRef.current?.blur();
						}
					}}
				/>
			</div>

			{showToolbar && (
				<div className="mstd-composer-toolbar">
					<div className="mstd-composer-options">
						<DueDateControl value={dueDate} onChange={setDueDate} />

						<button
							type="button"
							className={`mstd-chip-button${importance === "high" ? " is-active" : ""}`}
							aria-pressed={importance === "high"}
							onClick={() => setImportance(importance === "high" ? "normal" : "high")}
							title={importance === "high" ? "Remove importance" : "Mark as important"}
						>
							<Icon name="star" />
							<span>Important</span>
						</button>

						{props.showListPicker && props.lists.length > 0 && (
							<select
								className="mstd-composer-list dropdown"
								value={targetListId ?? ""}
								onChange={(event) => props.onChangeTargetList(event.target.value)}
								aria-label="List for the new task"
								title="List for the new task"
							>
								{props.lists.map((list) => (
									<option key={list.id} value={list.id}>
										{list.displayName}
									</option>
								))}
							</select>
						)}
					</div>

					<button
						type="button"
						className="mstd-composer-submit"
						disabled={!canSubmit}
						onClick={() => void submit()}
						title="Add task (Enter)"
					>
						{submitting ? "Adding…" : "Add"}
					</button>
				</div>
			)}
		</div>
	);
}
