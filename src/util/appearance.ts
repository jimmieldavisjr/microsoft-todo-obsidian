import type { CSSProperties } from "react";
import type { TodoTaskList } from "../types/microsoft-todo";

/**
 * Colours and icons for lists and tags.
 *
 * Graph stores neither a colour nor an icon for a To Do list, and categories
 * come back as bare strings, so the plugin keeps list choices in its own
 * settings and derives tag colours from the tag name. Every colour is one of
 * Obsidian's named palette variables, so it follows the active theme.
 */

export const PALETTE = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
export type PaletteColor = (typeof PALETTE)[number];

export const LIST_ICONS = [
	"list",
	"list-checks",
	"briefcase",
	"user",
	"home",
	"book-open",
	"graduation-cap",
	"gem",
	"code",
	"folder",
	"heart",
	"target",
	"shopping-cart",
	"plane",
	"dumbbell",
	"lightbulb",
] as const;

export interface ListAppearance {
	color?: PaletteColor;
	icon?: string;
}

/** Stable, well-spread hash so a tag keeps its colour across sessions. */
function hash(value: string): number {
	let h = 2166136261;
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

export function colorForKey(key: string): PaletteColor {
	return PALETTE[hash(key.toLowerCase()) % PALETTE.length];
}

/**
 * The resolved look of a list: whatever the user chose, else a default. The
 * built-in lists get the glyphs Microsoft To Do gives them.
 */
export function resolveListAppearance(
	list: TodoTaskList,
	saved: Record<string, ListAppearance> | undefined
): { color: PaletteColor; icon: string } {
	const choice = saved?.[list.id] ?? {};
	const defaultIcon =
		list.wellknownListName === "defaultList"
			? "home"
			: list.wellknownListName === "flaggedEmails"
				? "flag"
				: "list";
	return {
		color: choice.color ?? colorForKey(list.id),
		icon: choice.icon ?? defaultIcon,
	};
}

/** Inline style that feeds a palette colour to CSS as `--mstd-tint`. */
export function tintStyle(color: PaletteColor): CSSProperties {
	// Custom properties aren't part of React's CSSProperties type.
	return {
		"--mstd-tint": `var(--color-${color})`,
		"--mstd-tint-rgb": `var(--color-${color}-rgb)`,
	} as CSSProperties;
}
