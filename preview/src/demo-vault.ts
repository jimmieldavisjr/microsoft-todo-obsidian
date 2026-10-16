/** A few notes for the preview's file explorer, note tab and "Linked notes". */

export const DEMO_VAULT = "Demo vault";

export interface DemoNote {
	path: string;
	description?: string;
	content: string;
}

export const NOTES: DemoNote[] = [
	{
		path: "Projects/Q4 roadmap.md",
		description: "Themes, owners and milestones for the quarter.",
		content: "# Q4 roadmap\n\nThree themes this quarter: reliability, onboarding, and the mobile launch.\n\n## Milestones\n\n- October: reliability fixes shipped\n- November: new onboarding flow\n- December: mobile beta\n",
	},
	{
		path: "Meetings/Monday sync.md",
		description: "Weekly team sync agenda.",
		content: "# Monday sync\n\n## Agenda\n\n1. Roadmap check-in\n2. Blockers\n3. Demos\n",
	},
	{
		path: "Reading/Deep Work.md",
		content: "# Deep Work\n\n> Clarity about what matters provides clarity about what does not.\n\nNotes so far: schedule every minute, embrace boredom.\n",
	},
	{
		path: "Daily/Today.md",
		content: "# Today\n\nSelect a task in Microsoft To Do and use **Add to note** to drop a link here.\n\n",
	},
];
