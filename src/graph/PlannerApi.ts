import type { GraphClient } from "./GraphClient";
import { mapLimitSettled } from "../util/async";
import type { PlannerPlan, PlannerTask } from "../types/microsoft-todo";

/**
 * Read-only access to the Planner tasks assigned to the signed-in user - the
 * source Microsoft To Do uses for its own "Assigned to me" list.
 *
 * Planner is covered by the same `Tasks.ReadWrite` scope as To Do, but it only
 * exists for work and school accounts. Personal accounts get an error back, and
 * the caller treats that as "this view isn't available" rather than a failure.
 */
export class PlannerApi {
	/** Plan titles never change often enough to be worth refetching per refresh. */
	private readonly planTitles = new Map<string, string>();

	constructor(private readonly client: GraphClient) {}

	async getMyTasks(): Promise<PlannerTask[]> {
		return this.client.getAll<PlannerTask>("/me/planner/tasks");
	}

	/** Resolves plan titles for the given IDs, fetching only the ones not yet known. */
	async getPlanTitles(planIds: readonly string[]): Promise<Map<string, string>> {
		const missing = [...new Set(planIds)].filter((id) => !this.planTitles.has(id));

		const results = await mapLimitSettled(missing, 4, (id) =>
			this.client.get<PlannerPlan>(`/planner/plans/${encodeURIComponent(id)}`, { $select: "id,title" })
		);
		for (const result of results) {
			if (result.ok) this.planTitles.set(result.value.id, result.value.title);
		}

		return this.planTitles;
	}
}
