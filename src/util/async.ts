/** Runs `worker` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	if (items.length === 0) return [];

	const results = new Array<R>(items.length);
	let cursor = 0;

	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			results[index] = await worker(items[index], index);
		}
	});

	await Promise.all(runners);
	return results;
}

export type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/** `mapLimit` that captures failures instead of rejecting on the first one. */
export async function mapLimitSettled<T, R>(
	items: readonly T[],
	limit: number,
	worker: (item: T, index: number) => Promise<R>
): Promise<Settled<R>[]> {
	return mapLimit<T, Settled<R>>(items, limit, async (item, index) => {
		try {
			return { ok: true, value: await worker(item, index) };
		} catch (error) {
			return { ok: false, error };
		}
	});
}
