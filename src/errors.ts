/**
 * Error taxonomy. Every layer below the UI throws one of these so the view can
 * render a useful message and the right recovery action instead of a raw
 * stack trace or a silent failure.
 */

export type AppErrorKind =
	| "not-configured"
	| "auth-required"
	| "auth-expired"
	| "auth-declined"
	/** The user backed out of sign-in - not a failure worth reporting. */
	| "cancelled"
	| "permission"
	| "network"
	| "service-unavailable"
	| "rate-limited"
	| "not-found"
	| "graph";

export interface AppErrorOptions {
	/** Underlying HTTP status, when there was one. */
	status?: number;
	/** Graph's machine-readable error code, e.g. `ErrorItemNotFound`. */
	code?: string;
	/** True when retrying the same request could plausibly succeed. */
	retryable?: boolean;
	cause?: unknown;
}

export class AppError extends Error {
	readonly kind: AppErrorKind;
	readonly status?: number;
	readonly code?: string;
	readonly retryable: boolean;

	constructor(kind: AppErrorKind, message: string, options: AppErrorOptions = {}) {
		super(message);
		this.name = "AppError";
		this.kind = kind;
		this.status = options.status;
		this.code = options.code;
		this.retryable = options.retryable ?? false;
		if (options.cause !== undefined) {
			(this as { cause?: unknown }).cause = options.cause;
		}
	}

	/** True when the user needs to (re-)connect their Microsoft account. */
	get requiresSignIn(): boolean {
		return this.kind === "auth-required" || this.kind === "auth-expired";
	}
}

export function notConfigured(): AppError {
	return new AppError(
		"not-configured",
		"No Azure application (client) ID is set. Add one in Settings -> Microsoft To Do."
	);
}

export function authRequired(message = "You are not signed in to Microsoft To Do."): AppError {
	return new AppError("auth-required", message);
}

export function authExpired(
	message = "Your Microsoft sign-in has expired. Please connect your account again."
): AppError {
	return new AppError("auth-expired", message);
}

/** Normalises anything thrown into an AppError so the UI has one shape to handle. */
export function toAppError(error: unknown): AppError {
	if (error instanceof AppError) return error;

	const message = error instanceof Error ? error.message : String(error);

	// Obsidian's requestUrl surfaces DNS/offline failures as generic errors.
	if (/net::|ERR_|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|Failed to fetch|network/i.test(message)) {
		return new AppError(
			"network",
			"Could not reach Microsoft Graph. Check your network connection and try again.",
			{ retryable: true, cause: error }
		);
	}

	return new AppError("graph", message || "An unexpected error occurred.", { cause: error });
}

/** Short, user-facing summary suitable for a Notice or an error banner. */
export function describeError(error: unknown): string {
	const appError = toAppError(error);
	switch (appError.kind) {
		case "not-configured":
		case "auth-required":
		case "auth-expired":
		case "auth-declined":
		case "cancelled":
		case "network":
			return appError.message;
		case "permission":
			return `Microsoft Graph denied the request: ${appError.message}`;
		case "service-unavailable":
			return "Microsoft Graph is temporarily unavailable. Try again in a moment.";
		case "rate-limited":
			return "Microsoft Graph is throttling requests. Try again in a moment.";
		case "not-found":
			return "That item no longer exists in Microsoft To Do. Refresh to see the latest.";
		default:
			return appError.message;
	}
}
