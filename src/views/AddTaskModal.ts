import { App, Modal, Notice, Setting } from "obsidian";
import type { TaskService } from "../services/TaskService";
import { describeError } from "../errors";
import { parseDateInput } from "../util/date";
import type { CreateTaskInput, TodoTaskList } from "../types/microsoft-todo";

/**
 * Command Palette entry point for creating a task, used when there is no panel
 * input to type into (and by "Add selected text/current note" when they need to
 * confirm the target list).
 */
export class AddTaskModal extends Modal {
	private taskTitle = "";
	private listId: string;
	private dueDateValue = "";
	private notes = "";
	private submitting = false;

	constructor(app: App, private readonly service: TaskService) {
		super(app);
		this.listId = this.service.resolveTargetListId() ?? "";
	}

	onOpen(): void {
		this.titleEl.setText("Add task to Microsoft To Do");
		const { contentEl } = this;
		contentEl.empty();

		const lists = this.service.getState().lists;
		if (lists.length === 0) {
			contentEl.createEl("p", {
				text: "No Microsoft To Do lists are loaded yet. Open the Microsoft To Do panel and refresh, then try again.",
			});
			new Setting(contentEl).addButton((button) =>
				button.setButtonText("Close").onClick(() => this.close())
			);
			return;
		}

		let titleInput: HTMLInputElement | null = null;

		new Setting(contentEl).setName("Task").addText((text) => {
			titleInput = text.inputEl;
			text.setPlaceholder("What needs doing?").onChange((value) => {
				this.taskTitle = value;
			});
			text.inputEl.addClass("mstd-modal-input");
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void this.submit();
				}
			});
		});

		new Setting(contentEl).setName("List").addDropdown((dropdown) => {
			for (const list of lists) dropdown.addOption(list.id, list.displayName);
			dropdown.setValue(this.resolveInitialListId(lists));
			this.listId = dropdown.getValue();
			dropdown.onChange((value) => {
				this.listId = value;
			});
		});

		new Setting(contentEl).setName("Due date").addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => {
				this.dueDateValue = value;
			});
		});

		new Setting(contentEl).setName("Notes").addTextArea((text) => {
			text.setValue(this.notes).onChange((value) => {
				this.notes = value;
			});
			text.inputEl.rows = 3;
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Add task")
					.setCta()
					.onClick(() => void this.submit())
			);

		window.setTimeout(() => titleInput?.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private resolveInitialListId(lists: TodoTaskList[]): string {
		const known = lists.some((list) => list.id === this.listId);
		return known ? this.listId : lists[0].id;
	}

	private async submit(): Promise<void> {
		if (this.submitting) return;

		const title = this.taskTitle.trim();
		if (!title) {
			new Notice("Give the task a title first.");
			return;
		}
		if (!this.listId) {
			new Notice("Choose a list for the task.");
			return;
		}

		this.submitting = true;
		const input: CreateTaskInput = {
			title,
			body: this.notes.trim() || undefined,
			dueDate: this.dueDateValue ? parseDateInput(this.dueDateValue) : null,
		};

		try {
			await this.service.createTask(this.listId, input);
			const listName =
				this.service.getState().lists.find((list) => list.id === this.listId)?.displayName ?? "Microsoft To Do";
			new Notice(`Added to ${listName}.`);
			this.close();
		} catch (error) {
			new Notice(describeError(error));
		} finally {
			this.submitting = false;
		}
	}
}
