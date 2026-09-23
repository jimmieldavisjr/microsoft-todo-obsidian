import { Notice, TFile, type App } from "obsidian";

/**
 * Precedes the note reference appended to a task's notes. Shared by the builder
 * and the parser below so the two can't drift apart.
 */
export const NOTE_REFERENCE_PREFIX = "Obsidian note: ";

export type NoteLinkStyle = "uri" | "path";

/** Builds the note reference line appended to a task's notes when it is created from a note. */
export function buildNoteReference(vaultName: string, filePath: string, style: NoteLinkStyle): string {
	if (style === "path") return `${NOTE_REFERENCE_PREFIX}${filePath}`;

	const vault = encodeURIComponent(vaultName);
	const file = encodeURIComponent(filePath);
	return `${NOTE_REFERENCE_PREFIX}obsidian://open?vault=${vault}&file=${file}`;
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

/** Opens the note a task was created from directly in the workspace, rather than round-tripping through the obsidian:// handler. */
export async function openSourceNote(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		new Notice("That note could not be found in this vault.");
		return;
	}
	await app.workspace.getLeaf(false).openFile(file);
}
