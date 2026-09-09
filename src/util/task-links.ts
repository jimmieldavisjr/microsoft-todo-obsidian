import { Notice } from "obsidian";

export const TODO_WEB_URL = "https://to-do.office.com";

/**
 * Microsoft Graph does not expose a webUrl for todoTask resources. This is the
 * route currently used by the Microsoft To Do web client, but it is not an
 * officially supported Graph contract and could change.
 */
export function getTodoTaskUrl(taskId: string): string {
	return `${TODO_WEB_URL}/tasks/${encodeURIComponent(taskId)}/details`;
}

/** Preserves selected Markdown while making it safe to use as link text. */
export function createTodoTaskMarkdownLink(label: string, taskId: string): string {
	const escapedLabel = label
		.replace(/\\/g, "\\\\")
		.replace(/\[/g, "\\[")
		.replace(/\]/g, "\\]");
	return `[${escapedLabel}](${getTodoTaskUrl(taskId)})`;
}

/** Shows a success message with a link to the task just returned by Graph. */
export function showTaskCreatedNotice(message: string, taskId: string): void {
	const fragment = document.createDocumentFragment();
	fragment.append(message, " ");

	const link = document.createElement("a");
	link.textContent = "Open task";
	link.href = getTodoTaskUrl(taskId);
	link.target = "_blank";
	link.rel = "noopener";
	fragment.append(link);

	new Notice(fragment);
}
