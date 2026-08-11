import { useEffect, useRef } from "react";
import { setIcon } from "obsidian";

/**
 * Renders one of Obsidian's built-in (Lucide) icons, so the panel inherits the
 * host theme's icon set rather than shipping its own.
 */
export function Icon({ name, className }: { name: string; className?: string }): JSX.Element {
	const ref = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		element.textContent = "";
		setIcon(element, name);
	}, [name]);

	return <span ref={ref} className={className ? `mstd-icon ${className}` : "mstd-icon"} aria-hidden="true" />;
}
