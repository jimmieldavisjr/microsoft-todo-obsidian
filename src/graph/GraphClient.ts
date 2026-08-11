import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { MicrosoftAuth } from "../auth/MicrosoftAuth";
import { AppError, authExpired, toAppError } from "../errors";
import type { GraphCollection, GraphErrorBody } from "../types/microsoft-todo";

/**
 * Thin HTTP layer over Microsoft Graph.
 *
 * Owns everything transport-shaped so the layers above it never touch HTTP:
 * bearer tokens, one silent retry on 401, throttle/outage backoff, `@odata`
 * paging, and translating Graph error bodies into `AppError`s.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** 429/503 retries. Graph's own guidance is to back off and retry a few times. */
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 20_000;

/** Safety valve so a pathological `nextLink` chain can't loop forever. */
const MAX_PAGES = 25;

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface GraphRequestOptions {
	method?: HttpMethod;
	/** Path relative to the Graph v1.0 root, e.g. `/me/todo/lists`. */
	path: string;
	query?: Record<string, string | number | undefined>;
	body?: unknown;
	/** Absolute URL; when set, `path`/`query` are ignored. Used for `@odata.nextLink`. */
	url?: string;
}

export class GraphClient {
	constructor(private readonly auth: MicrosoftAuth) {}

	async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
		return this.request<T>({ method: "GET", path, query });
	}

	async post<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>({ method: "POST", path, body });
	}

	async patch<T>(path: string, body: unknown): Promise<T> {
		return this.request<T>({ method: "PATCH", path, body });
	}

	async delete(path: string): Promise<void> {
		await this.request<void>({ method: "DELETE", path });
	}

	/**
	 * Follows `@odata.nextLink` until the collection is exhausted and returns the
	 * flattened result.
	 */
	async getAll<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T[]> {
		const items: T[] = [];
		let page = await this.request<GraphCollection<T>>({ method: "GET", path, query });
		items.push(...(page.value ?? []));

		for (let i = 1; i < MAX_PAGES; i++) {
			const next = page["@odata.nextLink"];
			if (!next) break;
			page = await this.request<GraphCollection<T>>({ method: "GET", path, url: next });
			items.push(...(page.value ?? []));
		}

		return items;
	}

	async request<T>(options: GraphRequestOptions): Promise<T> {
		const url = options.url ?? buildUrl(options.path, options.query);
		const method = options.method ?? "GET";

		let retries = 0;
		let refreshed = false;

		for (;;) {
			const token = await this.auth.getAccessToken(refreshed);
			const response = await this.send(url, method, token, options.body);

			if (response.status >= 200 && response.status < 300) {
				return parseBody<T>(response);
			}

			// An access token can be revoked mid-life. Force one refresh and retry
			// before concluding the session is dead.
			if (response.status === 401 && !refreshed) {
				refreshed = true;
				continue;
			}

			if ((response.status === 429 || response.status === 503 || response.status === 504) && retries < MAX_RETRIES) {
				retries++;
				await sleep(retryDelayMs(response, retries));
				continue;
			}

			throw this.toGraphError(response, method, url);
		}
	}

	private async send(
		url: string,
		method: HttpMethod,
		token: string,
		body: unknown
	): Promise<RequestUrlResponse> {
		try {
			return await requestUrl({
				url,
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
				...(body === undefined
					? {}
					: { contentType: "application/json", body: JSON.stringify(body) }),
				throw: false,
			});
		} catch (error) {
			// requestUrl only throws here for transport-level failures.
			throw toAppError(error);
		}
	}

	private toGraphError(response: RequestUrlResponse, method: HttpMethod, url: string): AppError {
		const body = safeJson(response.text) as GraphErrorBody | null;
		const code = body?.error?.code;
		const message = body?.error?.message?.trim();

		switch (response.status) {
			case 401:
				return authExpired();

			case 403:
				return new AppError(
					"permission",
					message ??
						"Your account does not have permission for this operation. Check that the Tasks.ReadWrite permission was granted during sign-in.",
					{ status: 403, code }
				);

			case 404:
				return new AppError("not-found", message ?? "The requested item was not found in Microsoft To Do.", {
					status: 404,
					code,
				});

			case 429:
				return new AppError("rate-limited", message ?? "Microsoft Graph is throttling requests.", {
					status: 429,
					code,
					retryable: true,
				});

			default:
				if (response.status >= 500) {
					return new AppError("service-unavailable", message ?? "Microsoft Graph is temporarily unavailable.", {
						status: response.status,
						code,
						retryable: true,
					});
				}
				return new AppError(
					"graph",
					message ?? `Microsoft Graph request failed (${method} ${redact(url)} - HTTP ${response.status}).`,
					{ status: response.status, code }
				);
		}
	}
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
	const url = `${GRAPH_BASE}${path.startsWith("/") ? path : `/${path}`}`;
	if (!query) return url;

	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "") params.append(key, String(value));
	}

	const queryString = params.toString();
	return queryString ? `${url}?${queryString}` : url;
}

function parseBody<T>(response: RequestUrlResponse): T {
	// 204 No Content, and DELETE in general, come back empty.
	if (response.status === 204 || !response.text) return undefined as T;
	const parsed = safeJson(response.text);
	return (parsed ?? (undefined as unknown)) as T;
}

function safeJson(text: string | undefined): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Honours `Retry-After` when Graph sends one, otherwise exponential backoff. */
function retryDelayMs(response: RequestUrlResponse, attempt: number): number {
	const header = response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
	const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
	const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2 ** attempt * 500;
	return Math.min(delay, MAX_RETRY_DELAY_MS);
}

/** Keeps opaque Graph item IDs out of user-visible error strings. */
function redact(url: string): string {
	return url.replace(GRAPH_BASE, "").replace(/\/[A-Za-z0-9_\-=]{40,}/g, "/...");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
