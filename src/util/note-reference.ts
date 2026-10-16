import { Notice, TFile, type App } from "obsidian";
import type { LinkedResource, LinkedResourceInput } from "../types/microsoft-todo";

/**
 * Precedes the note reference appended to a task's notes. Shared by the builder
 * and the parser below so the two can't drift apart.
 */
export const NOTE_REFERENCE_PREFIX = "Obsidian note: ";

export type NoteLinkStyle = "uri" | "path";

/** Builds the note reference line appended to a task's notes when it is created from a note. */
export function buildNoteReference(vaultName: string, filePath: string, style: NoteLinkStyle): string {
	if (style === "path") return `${NOTE_REFERENCE_PREFIX}${filePath}`;
	return `${NOTE_REFERENCE_PREFIX}${buildObsidianUri(vaultName, filePath)}`;
}

/**
 * Vault-relative path of the note a task was created from, read back out of its
 * notes. Recognises both reference styles `buildNoteReference` produces.
 */
export function findSourceNotePath(notes: string | null | undefined): string | null {
	if (!notes) return null;

	for (const rawLine of notes.split("\n")) {
		const line = rawLine.trim();
		if (!line.startsWith(NOTE_REFERENCE_PREFIX)) continue;

		const value = line.slice(NOTE_REFERENCE_PREFIX.length).trim();
		if (!value) continue;

		if (value.startsWith("obsidian://")) {
			const queryIndex = value.indexOf("?");
			if (queryIndex === -1) continue;
			const file = new URLSearchParams(value.slice(queryIndex + 1)).get("file");
			if (file) return file;
			continue;
		}

		return value;
	}

	return null;
}

/**
 * Opens the note a task was created from directly in the workspace, rather than
 * round-tripping through the obsidian:// handler.
 *
 * Reuses the most recent editor when there is one. When the To Do view is
 * itself the most recent tab, opening "in place" would replace it, so the note
 * gets a tab of its own instead.
 */
export async function openSourceNote(app: App, path: string, newTab = false): Promise<void> {
	const file = resolveNote(app, path);
	if (!file) {
		new Notice("That note could not be found in this vault.");
		return;
	}
	const recent = app.workspace.getMostRecentLeaf();
	const reusable = !newTab && recent && recent.view.getViewType() === "markdown";
	await (reusable ? recent : app.workspace.getLeaf("tab")).openFile(file);
}

/** `applicationName` the plugin stamps on the linked resources it creates. */
export const OBSIDIAN_APP_NAME = "Obsidian";

export function buildObsidianUri(vaultName: string, filePath: string): string {
	return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(filePath)}`;
}

/**
 * The linked resource that ties a task to a note. `externalId` carries the
 * vault path so the plugin can resolve the note even if the URI's vault name
 * doesn't match this vault; `webUrl` is what the To Do apps open on a click.
 */
export function buildNoteLinkedResource(vaultName: string, file: TFile): LinkedResourceInput {
	return {
		webUrl: buildObsidianUri(vaultName, file.path),
		displayName: file.basename,
		applicationName: OBSIDIAN_APP_NAME,
		externalId: file.path,
	};
}

/** Vault path of the note a linked resource points at, or `null` if it isn't a note link. */
export function linkedNotePath(resource: LinkedResource): string | null {
	const url = resource.webUrl ?? "";
	const isObsidian = resource.applicationName === OBSIDIAN_APP_NAME || url.startsWith("obsidian://");
	if (!isObsidian) return null;

	if (resource.externalId) return resource.externalId;

	const queryIndex = url.indexOf("?");
	if (queryIndex === -1) return null;
	return new URLSearchParams(url.slice(queryIndex + 1)).get("file");
}

/** Resolves a vault path the way links do, tolerating a missing `.md` extension. */
export function resolveNote(app: App, path: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(path);
	if (direct instanceof TFile) return direct;
	const withExtension = app.vault.getAbstractFileByPath(`${path}.md`);
	if (withExtension instanceof TFile) return withExtension;
	return app.metadataCache.getFirstLinkpathDest(path, "");
}
