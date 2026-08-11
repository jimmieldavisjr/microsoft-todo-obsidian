import { requestUrl } from "obsidian";
import { AppError, authExpired, authRequired, notConfigured, toAppError } from "../errors";

/**
 * Microsoft identity platform sign-in using the OAuth 2.0 **device code flow**.
 *
 * Why device code rather than authorization-code/PKCE: Obsidian plugins have no
 * stable redirect target on every platform (no loopback server on mobile, and
 * `obsidian://` custom-scheme redirects need extra Azure configuration that
 * trips people up). The device code flow needs no redirect URI at all, works
 * identically on desktop and mobile, and requires no client secret - which
 * matters because a plugin shipped to users cannot keep one.
 *
 * Requirements on the Azure app registration:
 *   - "Allow public client flows" = Yes
 *   - Delegated permission: Tasks.ReadWrite (plus openid/profile/offline_access)
 *
 * Docs: https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code
 */

const AUTHORITY = "https://login.microsoftonline.com";

/** `offline_access` is what gets us a refresh token; `openid profile` gives us the account label. */
export const DEFAULT_SCOPES = "openid profile offline_access Tasks.ReadWrite";

/** Refresh this far ahead of real expiry so in-flight requests don't race the clock. */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export interface AuthConfig {
	clientId: string;
	/** `common`, `organizations`, `consumers`, or a tenant GUID. */
	tenantId: string;
}

export interface AccountInfo {
	username: string;
	name: string;
}

/** Shape persisted to `data.json`. */
export interface StoredAuthSession {
	version: 1;
	clientId: string;
	tenantId: string;
	scopes: string;
	refreshToken: string;
	accessToken?: string;
	/** Epoch millis. */
	expiresAt?: number;
	account?: AccountInfo;
}

export interface DeviceCodePrompt {
	userCode: string;
	verificationUri: string;
	/** Epoch millis after which the code stops working. */
	expiresAt: number;
	/** Microsoft's own instruction text. */
	message: string;
}

export interface AuthPersistence {
	load(): StoredAuthSession | null;
	save(session: StoredAuthSession | null): Promise<void>;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	id_token?: string;
	expires_in: number;
	token_type: string;
	scope?: string;
}

interface OAuthErrorResponse {
	error: string;
	error_description?: string;
}

type AuthListener = () => void;

export class MicrosoftAuth {
	private session: StoredAuthSession | null = null;
	private refreshInFlight: Promise<string> | null = null;
	private readonly listeners = new Set<AuthListener>();

	constructor(
		private readonly getConfig: () => AuthConfig,
		private readonly persistence: AuthPersistence
	) {}

	/** Restores a persisted session, discarding it if it belongs to a different app registration. */
	load(): void {
		const stored = this.persistence.load();
		if (!stored || stored.version !== 1 || !stored.refreshToken) {
			this.session = null;
			return;
		}

		const { clientId, tenantId } = this.getConfig();
		// Tokens are bound to the app registration that issued them.
		if (stored.clientId !== clientId || stored.tenantId !== tenantId) {
			this.session = null;
			return;
		}

		this.session = stored;
	}

	onChange(listener: AuthListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	get isSignedIn(): boolean {
		return this.session !== null;
	}

	get account(): AccountInfo | null {
		return this.session?.account ?? null;
	}

	get isConfigured(): boolean {
		return this.getConfig().clientId.trim().length > 0;
	}

	/* ---------------------------------------------------------------------- */
	/* Sign in                                                                */
	/* ---------------------------------------------------------------------- */

	/**
	 * Runs the full device code flow. `onPrompt` fires once, as soon as
	 * Microsoft hands back a user code to display.
	 *
	 * Resolves when the user finishes signing in; rejects if they decline, the
	 * code expires, or `signal` aborts.
	 */
	async signIn(onPrompt: (prompt: DeviceCodePrompt) => void, signal?: AbortSignal): Promise<AccountInfo> {
		const config = this.requireConfig();

		const device = await this.postForm<{
			device_code: string;
			user_code: string;
			verification_uri: string;
			expires_in: number;
			interval?: number;
			message?: string;
		}>(`${AUTHORITY}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/devicecode`, {
			client_id: config.clientId,
			scope: DEFAULT_SCOPES,
		});

		const expiresAt = Date.now() + device.expires_in * 1000;
		onPrompt({
			userCode: device.user_code,
			verificationUri: device.verification_uri,
			expiresAt,
			message: device.message ?? "",
		});

		// Microsoft tells us how often to poll; respect it or we get `slow_down`.
		let intervalMs = (device.interval ?? 5) * 1000;

		for (;;) {
			throwIfAborted(signal);
			await sleep(intervalMs, signal);
			throwIfAborted(signal);

			if (Date.now() > expiresAt) {
				throw new AppError("auth-required", "The sign-in code expired before it was used. Try connecting again.");
			}

			const result = await this.pollToken(config, device.device_code);

			if (result.kind === "token") {
				const account = this.adoptTokens(config, result.token);
				await this.persist();
				this.emit();
				return account;
			}

			if (result.kind === "slow-down") {
				intervalMs += 5000;
				continue;
			}

			// `pending` - keep waiting.
		}
	}

	private async pollToken(
		config: AuthConfig,
		deviceCode: string
	): Promise<{ kind: "token"; token: TokenResponse } | { kind: "pending" } | { kind: "slow-down" }> {
		const url = `${AUTHORITY}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
		const response = await this.rawPostForm(url, {
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			client_id: config.clientId,
			device_code: deviceCode,
		});

		if (response.ok) {
			return { kind: "token", token: response.body as TokenResponse };
		}

		const error = (response.body as OAuthErrorResponse | null)?.error ?? "";
		switch (error) {
			case "authorization_pending":
				return { kind: "pending" };
			case "slow_down":
				return { kind: "slow-down" };
			case "authorization_declined":
				throw new AppError("auth-declined", "Sign-in was declined in the browser.");
			case "expired_token":
				throw new AppError("auth-required", "The sign-in code expired before it was used. Try connecting again.");
			case "bad_verification_code":
				throw new AppError("auth-required", "Microsoft rejected the sign-in code. Try connecting again.");
			default:
				throw this.oauthError(response);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Tokens                                                                 */
	/* ---------------------------------------------------------------------- */

	/**
	 * Returns a usable access token, refreshing it if it is expired or close to
	 * expiring. Concurrent callers share a single refresh.
	 */
	async getAccessToken(forceRefresh = false): Promise<string> {
		if (!this.isConfigured) throw notConfigured();
		const session = this.session;
		if (!session) throw authRequired();

		const stillFresh =
			!forceRefresh &&
			session.accessToken !== undefined &&
			session.expiresAt !== undefined &&
			session.expiresAt - EXPIRY_SKEW_MS > Date.now();

		if (stillFresh) return session.accessToken as string;

		if (!this.refreshInFlight) {
			this.refreshInFlight = this.refreshAccessToken().finally(() => {
				this.refreshInFlight = null;
			});
		}
		return this.refreshInFlight;
	}

	private async refreshAccessToken(): Promise<string> {
		const config = this.requireConfig();
		const session = this.session;
		if (!session) throw authRequired();

		const url = `${AUTHORITY}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
		const response = await this.rawPostForm(url, {
			grant_type: "refresh_token",
			client_id: config.clientId,
			refresh_token: session.refreshToken,
			scope: DEFAULT_SCOPES,
		});

		if (!response.ok) {
			const error = (response.body as OAuthErrorResponse | null)?.error ?? "";
			// The refresh token is dead (revoked, expired, password changed, consent
			// withdrawn). Nothing to salvage - drop the session and ask for sign-in.
			if (error === "invalid_grant" || error === "invalid_client" || error === "unauthorized_client") {
				await this.clearSession();
				throw authExpired();
			}
			throw this.oauthError(response);
		}

		this.adoptTokens(config, response.body as TokenResponse);
		await this.persist();
		this.emit();
		return (this.session as StoredAuthSession).accessToken as string;
	}

	/** Folds a token response into the current session. */
	private adoptTokens(config: AuthConfig, token: TokenResponse): AccountInfo {
		const account = readAccountFromIdToken(token.id_token) ?? this.session?.account ?? {
			username: "Microsoft account",
			name: "Microsoft account",
		};

		this.session = {
			version: 1,
			clientId: config.clientId,
			tenantId: config.tenantId,
			scopes: token.scope ?? DEFAULT_SCOPES,
			// Microsoft rotates refresh tokens; keep the newest one it gives us.
			refreshToken: token.refresh_token ?? this.session?.refreshToken ?? "",
			accessToken: token.access_token,
			expiresAt: Date.now() + token.expires_in * 1000,
			account,
		};

		return account;
	}

	async signOut(): Promise<void> {
		await this.clearSession();
		this.emit();
	}

	private async clearSession(): Promise<void> {
		this.session = null;
		await this.persistence.save(null);
	}

	private async persist(): Promise<void> {
		await this.persistence.save(this.session);
	}

	/** Drops cached tokens without forgetting the account - used when config changes. */
	async invalidate(): Promise<void> {
		await this.clearSession();
		this.emit();
	}

	private requireConfig(): AuthConfig {
		const config = this.getConfig();
		const clientId = config.clientId.trim();
		if (!clientId) throw notConfigured();
		return { clientId, tenantId: config.tenantId.trim() || "common" };
	}

	/* ---------------------------------------------------------------------- */
	/* HTTP                                                                   */
	/* ---------------------------------------------------------------------- */

	private async postForm<T>(url: string, form: Record<string, string>): Promise<T> {
		const response = await this.rawPostForm(url, form);
		if (!response.ok) throw this.oauthError(response);
		return response.body as T;
	}

	/**
	 * Uses Obsidian's `requestUrl` rather than `fetch`: the identity endpoints
	 * do not send CORS headers for non-SPA clients, so a renderer `fetch` would
	 * be blocked before it ever reached Microsoft.
	 */
	private async rawPostForm(
		url: string,
		form: Record<string, string>
	): Promise<{ ok: boolean; status: number; body: unknown }> {
		const body = new URLSearchParams(form).toString();

		try {
			const response = await requestUrl({
				url,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				headers: { Accept: "application/json" },
				body,
				throw: false,
			});

			return {
				ok: response.status >= 200 && response.status < 300,
				status: response.status,
				body: parseJson(response.text),
			};
		} catch (error) {
			throw toAppError(error);
		}
	}

	private oauthError(response: { status: number; body: unknown }): AppError {
		const body = response.body as OAuthErrorResponse | null;
		const code = body?.error;
		const description = body?.error_description?.split("\r\n")[0];

		// Microsoft's raw text names the missing OAuth parameter, not the portal
		// setting that causes it, so keep it for the console and lead the user
		// with something they can act on.
		if (description) console.error("[Microsoft To Do] sign-in error:", description);

		if (code === "invalid_client" || code === "unauthorized_client") {
			// AADSTS7000218: Entra is treating this as a confidential client and
			// wants a client secret, which is what "Allow public client flows =
			// No" does to a device code request.
			const isConfidentialClient =
				description?.includes("AADSTS7000218") ||
				description?.includes("client_secret") ||
				description?.includes("client_assertion");

			return new AppError(
				"not-configured",
				isConfidentialClient
					? "Microsoft is treating this app registration as a confidential client. In the Azure portal, open your app, go to Authentication -> Advanced settings, set 'Allow public client flows' to Yes, save, then connect again."
					: "Microsoft rejected this application. Check the Application (client) ID and the directory (tenant) setting.",
				{ status: response.status, code }
			);
		}

		// AADSTS50059 / AADSTS700016: the /common endpoint could not work out which
		// directory to sign the user into. In practice that means the app
		// registration is single-tenant, so it only accepts accounts from the one
		// directory it was created in - Microsoft reports it as a missing tenant
		// rather than as a misconfigured app.
		if (description?.includes("AADSTS50059") || description?.includes("AADSTS700016")) {
			return new AppError(
				"not-configured",
				"This app registration only accepts accounts from a single Microsoft directory. Either set 'Directory (tenant)' in the plugin settings to your organisation's tenant ID, or use an app registration whose supported account types include any directory and personal Microsoft accounts.",
				{ status: response.status, code }
			);
		}

		// AADSTS50020: the account exists, but not in the directory this app allows.
		if (description?.includes("AADSTS50020")) {
			return new AppError(
				"not-configured",
				"That Microsoft account is not allowed to use this app registration. It accepts accounts from a different directory - sign in with an account from that organisation, or use your own app registration in the plugin settings.",
				{ status: response.status, code }
			);
		}

		if (response.status === 429 || response.status >= 500) {
			return new AppError(
				"service-unavailable",
				description ?? "The Microsoft sign-in service is temporarily unavailable.",
				{ status: response.status, code, retryable: true }
			);
		}

		return new AppError("graph", description ?? code ?? `Sign-in failed (HTTP ${response.status}).`, {
			status: response.status,
			code,
		});
	}
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseJson(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Reads display claims out of the ID token.
 *
 * This is only ever used for the "signed in as ..." label. We deliberately do
 * not validate the signature - the token came straight from an HTTPS call to
 * the identity endpoint, and nothing security-relevant depends on the claims.
 */
function readAccountFromIdToken(idToken: string | undefined): AccountInfo | null {
	if (!idToken) return null;
	const parts = idToken.split(".");
	if (parts.length < 2) return null;

	try {
		const payload = JSON.parse(base64UrlDecode(parts[1])) as {
			preferred_username?: string;
			email?: string;
			upn?: string;
			name?: string;
		};
		const username = payload.preferred_username ?? payload.email ?? payload.upn ?? "";
		const name = payload.name ?? username;
		if (!username && !name) return null;
		return { username: username || name, name: name || username };
	} catch {
		return null;
	}
}

function base64UrlDecode(input: string): string {
	const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
	const binary = atob(padded);
	// Claims can contain non-ASCII (display names), so decode as UTF-8.
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		function onAbort() {
			window.clearTimeout(timer);
			reject(abortError());
		}

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError();
}

function abortError(): AppError {
	return new AppError("cancelled", "Sign-in was cancelled.");
}
