import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Icon } from "./Icon";
import {
	addDays,
	formatDueDate,
	nextMonday,
	parseDateInput,
	startOfToday,
	toDateInputValue,
} from "../util/date";

export interface DueDateControlProps {
	value: Date | null;
	onChange: (value: Date | null) => void;
	disabled?: boolean;
	/** Rendered when no date is set. */
	placeholder?: string;
}

/**
 * The due-date control, modelled on Microsoft To Do's own: a single labelled
 * button that opens a menu of the dates people actually pick.
 *
 * The previous design put bare "Today"/"Tomorrow" chips in the toolbar, which
 * read as unexplained toggles - there was nothing saying they set a due date.
 */
export function DueDateControl({
	value,
	onChange,
	disabled,
	placeholder = "Due date",
}: DueDateControlProps): ReactElement {
	const [open, setOpen] = useState(false);
	const [picking, setPicking] = useState(false);
	const [above, setAbove] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	/**
	 * Flip the menu upward when it would fall outside the viewport. The task
	 * list scrolls, so a menu on the last row would otherwise be clipped.
	 * Only `top`/`bottom` change, so this can't feed back into its own measurement.
	 */
	useLayoutEffect(() => {
		if (!open) {
			setAbove(false);
			return;
		}
		const trigger = rootRef.current?.getBoundingClientRect();
		const height = menuRef.current?.offsetHeight ?? 0;
		if (!trigger || !height) return;

		const spaceBelow = window.innerHeight - trigger.bottom;
		setAbove(spaceBelow < height + 12 && trigger.top > height + 12);
	}, [open, picking]);

	useEffect(() => {
		if (!open) return;

		function onPointerDown(event: MouseEvent): void {
			if (!rootRef.current?.contains(event.target as Node)) close();
		}
		function onKeyDown(event: KeyboardEvent): void {
			if (event.key === "Escape") {
				event.stopPropagation();
				close();
			}
		}

		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [open]);

	function close(): void {
		setOpen(false);
		setPicking(false);
	}

	function choose(date: Date | null): void {
		onChange(date);
		close();
	}

	return (
		<div className="mstd-due-control" ref={rootRef}>
			<button
				type="button"
				className={`mstd-chip-button${value ? " is-active" : ""}`}
				disabled={disabled}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => (open ? close() : setOpen(true))}
				title={value ? `Due ${formatDueDate(value)}` : "Set a due date"}
			>
				<Icon name="calendar" />
				<span>{value ? formatDueDate(value) : placeholder}</span>
			</button>

			{value && !disabled && (
				<button
					type="button"
					className="mstd-chip-clear"
					aria-label="Remove due date"
					title="Remove due date"
					onClick={() => choose(null)}
				>
					<Icon name="x" />
				</button>
			)}

			{open && (
				<div className={`mstd-menu${above ? " is-above" : ""}`} role="menu" ref={menuRef}>
					<MenuItem icon="sun" label="Today" hint={formatDueDate(startOfToday())} onSelect={() => choose(startOfToday())} />
					<MenuItem
						icon="sunrise"
						label="Tomorrow"
						hint={weekdayOf(addDays(startOfToday(), 1))}
						onSelect={() => choose(addDays(startOfToday(), 1))}
					/>
					<MenuItem
						icon="calendar-days"
						label="Next week"
						hint={formatDueDate(nextMonday())}
						onSelect={() => choose(nextMonday())}
					/>

					<div className="mstd-menu-separator" role="separator" />

					{picking ? (
						<div className="mstd-menu-picker">
							<input
								type="date"
								className="mstd-date-input"
								autoFocus
								value={toDateInputValue(value)}
								onChange={(event) => {
									const parsed = parseDateInput(event.target.value);
									if (parsed) choose(parsed);
								}}
								aria-label="Pick a due date"
							/>
						</div>
					) : (
						<MenuItem icon="calendar-plus" label="Pick a date" onSelect={() => setPicking(true)} />
					)}

					{value && <MenuItem icon="calendar-x" label="Remove due date" onSelect={() => choose(null)} />}
				</div>
			)}
		</div>
	);
}

function MenuItem(props: {
	icon: string;
	label: string;
	hint?: string;
	onSelect: () => void;
}): ReactElement {
	return (
		<button type="button" className="mstd-menu-item" role="menuitem" onClick={props.onSelect}>
			<Icon name={props.icon} />
			<span className="mstd-menu-label">{props.label}</span>
			{props.hint && <span className="mstd-menu-hint">{props.hint}</span>}
		</button>
	);
}

function weekdayOf(date: Date): string {
	return date.toLocaleDateString(undefined, { weekday: "short" });
}
