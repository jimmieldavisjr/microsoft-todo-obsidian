import { createContext, useContext, type RefObject } from "react";
import type { TaskFilter } from "../util/task-filters";

/**
 * How many columns fit. Measured from the view's own width, not the window's,
 * because the same view can live in a full editor tab or a narrow sidebar.
 *
 * - wide:   lists | tasks | details, all visible
 * - medium: lists | tasks, with details sliding over from the right
 * - narrow: tasks only, with lists as a drawer and details as an overlay
 */
export type Layout = "wide" | "medium" | "narrow";

export const WIDE_MIN_WIDTH = 1040;
export const MEDIUM_MIN_WIDTH = 700;

export function layoutForWidth(width: number): Layout {
	if (width >= WIDE_MIN_WIDTH) return "wide";
	if (width >= MEDIUM_MIN_WIDTH) return "medium";
	return "narrow";
}

/** UI-only state shared by the three columns. Nothing here is persisted. */
export interface PanelState {
	layout: Layout;

	selectedTaskId: string | null;
	selectTask: (taskId: string | null) => void;

	filter: TaskFilter;
	setFilter: (filter: TaskFilter) => void;

	search: string;
	setSearch: (search: string) => void;
	searchRef: RefObject<HTMLInputElement>;

	composerOpen: boolean;
	setComposerOpen: (open: boolean) => void;

	/** Only meaningful in the narrow layout, where the lists are a drawer. */
	sidebarOpen: boolean;
	setSidebarOpen: (open: boolean) => void;
}

const PanelContext = createContext<PanelState | null>(null);

export const PanelStateProvider = PanelContext.Provider;

export function usePanelState(): PanelState {
	const value = useContext(PanelContext);
	if (!value) throw new Error("usePanelState must be used inside the Microsoft To Do panel.");
	return value;
}
