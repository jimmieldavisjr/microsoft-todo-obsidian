import { AppError } from "../../src/errors";
import { addDays, startOfToday, toGraphDate } from "../../src/util/date";
import type {
	ChecklistItem,
	LinkedResource,
	PlannerPlan,
	PlannerTask,
	TodoTask,
	TodoTaskList,
} from "../../src/types/microsoft-todo";
import { DEMO_VAULT, NOTES } from "./demo-vault";

/**
 * An in-memory Microsoft Graph, answering the same REST paths the plugin's
 * `TodoApi` and `PlannerApi` call. The preview hands it to the real API
 * classes in place of `GraphClient`, so everything above HTTP - the API
 * adapters, `TaskService`, the components - runs exactly as in Obsidian.
 */

type Query = Record<string, string | number | undefined>;

/** Long enough to see loading states, short enough not to drag. */
const LATENCY_MS = 160;

let nextId = 1;
const newId = (prefix: string): string => `${prefix}-${(nextId++).toString(36)}`;
const now = (): string => new Date().toISOString();

interface StoredList {
	list: TodoTaskList;
	tasks: TodoTask[];
}

export class FakeGraph {
	private lists: StoredList[] = seedLists();
	private readonly plannerTasks: PlannerTask[] = seedPlanner();
	private readonly plans: PlannerPlan[] = [
		{ id: "plan-launch", title: "Q4 launch" },
		{ id: "plan-site", title: "Website refresh" },
	];

	/** Restores the demo data, e.g. after a round of experimenting. */
	reset(): void {
		this.lists = seedLists();
	}

	/* ---------------------------------------------------------------------- */
	/* The GraphClient surface                                                */
	/* ---------------------------------------------------------------------- */

	async get<T>(path: string, query?: Query): Promise<T> {
		return this.respond(() => this.route("GET", path, undefined, query) as T);
	}

	async getAll<T>(path: string, query?: Query): Promise<T[]> {
		return this.respond(() => this.route("GET", path, undefined, query) as T[]);
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.respond(() => this.route("POST", path, body) as T);
	}

	async patch<T>(path: string, body: unknown): Promise<T> {
		return this.respond(() => this.route("PATCH", path, body) as T);
	}

	async delete(path: string): Promise<void> {
		await this.respond(() => this.route("DELETE", path));
	}

	private async respond<T>(work: () => T): Promise<T> {
		await new Promise((resolve) => window.setTimeout(resolve, LATENCY_MS));
		// Copies, as JSON over the wire would be: the service must not share our objects.
		return structuredClone(work());
	}

	/* ---------------------------------------------------------------------- */
	/* Routing                                                                */
	/* ---------------------------------------------------------------------- */

	private route(method: string, path: string, body?: unknown, query?: Query): unknown {
		const parts = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
		const input = (body ?? {}) as Record<string, unknown>;

		if (parts[0] === "planner" && parts[1] === "plans") {
			return this.plans.find((plan) => plan.id === parts[2]) ?? notFound();
		}
		if (parts[0] === "me" && parts[1] === "planner") return this.plannerTasks;

		// /me/todo/lists/{list}/tasks/{task}/{collection}/{item}
		const [, , , listId, , taskId, collection, itemId] = parts;

		if (!listId) {
			if (method === "POST") return this.createList(String(input.displayName));
			return this.lists.map((entry) => entry.list);
		}

		const stored = this.lists.find((entry) => entry.list.id === listId) ?? notFound();

		if (parts[4] !== "tasks") {
			if (method === "PATCH") return Object.assign(stored.list, input);
			if (method === "DELETE") this.lists = this.lists.filter((entry) => entry !== stored);
			return stored.list;
		}

		if (!taskId) {
			if (method === "POST") return this.createTask(stored, input);
			return this.queryTasks(stored, query);
		}

		const task = stored.tasks.find((entry) => entry.id === taskId) ?? notFound();

		if (!collection) {
			if (method === "PATCH") return this.updateTask(task, input);
			if (method === "DELETE") stored.tasks = stored.tasks.filter((entry) => entry !== task);
			return task;
		}

		const items = (collection === "checklistItems" ? (task.checklistItems ??= []) : (task.linkedResources ??= [])) as Array<
			ChecklistItem | LinkedResource
		>;

		if (!itemId) {
			if (method === "POST") {
				const created = { id: newId(collection), createdDateTime: now(), ...input } as ChecklistItem | LinkedResource;
				items.push(created);
				return created;
			}
			return items;
		}

		const item = items.find((entry) => entry.id === itemId) ?? notFound();
		if (method === "PATCH") return Object.assign(item, input);
		if (method === "DELETE") items.splice(items.indexOf(item), 1);
		return item;
	}

	private createList(displayName: string): TodoTaskList {
		const list: TodoTaskList = { id: newId("list"), displayName, isOwner: true, isShared: false, wellknownListName: "none" };
		this.lists.push({ list, tasks: [] });
		return list;
	}

	private queryTasks(stored: StoredList, query?: Query): TodoTask[] {
		const filter = String(query?.$filter ?? "");
		const tasks = stored.tasks.filter((task) => {
			if (filter === "status ne 'completed'") return task.status !== "completed";
			if (filter === "status eq 'completed'") return task.status === "completed";
			return true;
		});
		const expand = String(query?.$expand ?? "");
		return tasks.map((task) => ({
			...task,
			checklistItems: expand.includes("checklistItems") ? task.checklistItems : undefined,
			linkedResources: expand.includes("linkedResources") ? task.linkedResources : undefined,
		}));
	}

	private createTask(stored: StoredList, input: Record<string, unknown>): TodoTask {
		const task: TodoTask = {
			id: newId("task"),
			title: "",
			status: "notStarted",
			importance: "normal",
			isReminderOn: false,
			createdDateTime: now(),
			lastModifiedDateTime: now(),
			categories: [],
			checklistItems: [],
			linkedResources: [],
			...(input as Partial<TodoTask>),
		};
		stored.tasks.push(task);
		return task;
	}

	private updateTask(task: TodoTask, input: Record<string, unknown>): TodoTask {
		Object.assign(task, input, { lastModifiedDateTime: now() });
		if ("status" in input) {
			task.completedDateTime = task.status === "completed" ? toGraphDate(new Date()) : null;
		}
		return task;
	}
}

function notFound(): never {
	throw new AppError("not-found", "That item no longer exists in Microsoft To Do.", { status: 404 });
}

/* -------------------------------------------------------------------------- */
/* Demo data                                                                  */
/* -------------------------------------------------------------------------- */

function due(days: number): TodoTask["dueDateTime"] {
	return toGraphDate(addDays(startOfToday(), days));
}

function noteLink(path: string): LinkedResource {
	return {
		id: newId("link"),
		webUrl: `obsidian://open?vault=${encodeURIComponent(DEMO_VAULT)}&file=${encodeURIComponent(path)}`,
		displayName: path.replace(/\.md$/, "").split("/").pop(),
		applicationName: "Obsidian",
		externalId: path,
	};
}

function steps(...entries: Array<[string, boolean]>): ChecklistItem[] {
	return entries.map(([displayName, isChecked]) => ({ id: newId("step"), displayName, isChecked }));
}

function task(fields: Partial<TodoTask> & { title: string }): TodoTask {
	const created = addDays(new Date(), -Math.floor(Math.random() * 20));
	return {
		id: newId("task"),
		status: "notStarted",
		importance: "normal",
		isReminderOn: false,
		createdDateTime: created.toISOString(),
		lastModifiedDateTime: created.toISOString(),
		categories: [],
		checklistItems: [],
		linkedResources: [],
		...fields,
	};
}

function list(id: string, displayName: string, extra: Partial<TodoTaskList> = {}): TodoTaskList {
	return { id, displayName, isOwner: true, isShared: false, wellknownListName: "none", ...extra };
}

function seedLists(): StoredList[] {
	const [projectNote, meetingNote, readingNote] = NOTES.map((note) => note.path);
	return [
		{
			list: list("list-tasks", "Tasks", { wellknownListName: "defaultList" }),
			tasks: [
				task({ title: "Renew passport", dueDateTime: due(-2), importance: "high", categories: ["Errand"] }),
				task({ title: "Book dentist appointment", dueDateTime: due(0) }),
				task({ title: "Back up the laptop", status: "completed", completedDateTime: due(-1) }),
			],
		},
		{
			list: list("list-work", "Work", { isShared: true }),
			tasks: [
				task({
					title: "Draft the Q4 roadmap",
					dueDateTime: due(0),
					importance: "high",
					categories: ["Planning"],
					body: { content: "Pull last quarter's numbers first.\nKeep it to one page.", contentType: "text" },
					checklistItems: steps(["Collect metrics", true], ["Outline themes", true], ["Review with team", false]),
					linkedResources: [noteLink(projectNote)],
				}),
				task({
					title: "Prepare slides for Monday sync",
					dueDateTime: due(3),
					categories: ["Meetings"],
					linkedResources: [noteLink(meetingNote)],
				}),
				task({ title: "Reply to vendor contract email", dueDateTime: due(-1), categories: ["Email"] }),
				task({ title: "Update onboarding checklist", dueDateTime: due(8) }),
				task({ title: "Send weekly status update", status: "completed", completedDateTime: due(-3) }),
			],
		},
		{
			list: list("list-personal", "Personal"),
			tasks: [
				task({ title: "Plan weekend hike", dueDateTime: due(4), categories: ["Outdoors"] }),
				task({
					title: "Call Mom",
					dueDateTime: due(1),
					importance: "high",
				}),
				task({ title: "Fix the bike's back brake" }),
			],
		},
		{
			list: list("list-groceries", "Groceries"),
			tasks: [
				task({ title: "Oat milk" }),
				task({ title: "Coffee beans", importance: "high" }),
				task({ title: "Spinach" }),
				task({ title: "Lemons" }),
			],
		},
		{
			list: list("list-reading", "Reading"),
			tasks: [
				task({
					title: "Finish “Deep Work”",
					categories: ["Books"],
					checklistItems: steps(["Part 1", true], ["Part 2", false]),
					linkedResources: [noteLink(readingNote)],
				}),
				task({ title: "Read the React 19 release notes", dueDateTime: due(6), categories: ["Tech"] }),
			],
		},
		{
			list: list("list-flagged", "Flagged email", { wellknownListName: "flaggedEmails" }),
			tasks: [task({ title: "Re: Conference travel booking", dueDateTime: due(2) })],
		},
	];
}

function seedPlanner(): PlannerTask[] {
	const iso = (days: number): string => addDays(startOfToday(), days).toISOString();
	return [
		{
			id: "planner-1",
			planId: "plan-launch",
			title: "Sign off launch checklist",
			percentComplete: 50,
			priority: 1,
			createdDateTime: iso(-6),
			dueDateTime: iso(2),
			checklistItemCount: 4,
			activeChecklistItemCount: 2,
		},
		{
			id: "planner-2",
			planId: "plan-site",
			title: "Review new homepage copy",
			percentComplete: 0,
			priority: 5,
			createdDateTime: iso(-2),
			dueDateTime: iso(5),
		},
	];
}
