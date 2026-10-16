import { App, FuzzySuggestModal, Modal, Setting, TFile, setIcon, type FuzzyMatch } from "obsidian";
import { LIST_ICONS, PALETTE, type ListAppearance, type PaletteColor } from "../util/appearance";
import type { TodoTaskList } from "../types/microsoft-todo";

/**
 * Small Obsidian-native dialogs the view opens. They are plain Obsidian API
 * rather than React so they look and behave exactly like the rest of the app.
 */

/** Resolves `true` on confirm, `false` on cancel or dismiss. */
export function confirmAction(
	app: App,
	options: { title: string; message: string; confirmText: string; destructive?: boolean }
): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private readonly options: { title: string; message: string; confirmText: string; destructive?: boolean },
		private readonly resolve: (value: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		this.contentEl.createEl("p", { text: this.options.message });
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.finish(false)))
			.addButton((button) => {
				button.setButtonText(this.options.confirmText).onClick(() => this.finish(true));
				// setDestructive is @since 1.13.0; this plugin supports 1.7.2 upward.
				if (this.options.destructive) button.setWarning();
				else button.setCta();
			});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolve(false);
	}

	private finish(value: boolean): void {
		this.resolved = true;
		this.resolve(value);
		this.close();
	}
}

/** Prompts for a single line of text, e.g. a list name. Resolves `null` on cancel. */
export function promptForText(
	app: App,
	options: { title: string; placeholder?: string; value?: string; submitText: string }
): Promise<string | null> {
	return new Promise((resolve) => {
		new TextPromptModal(app, options, resolve).open();
	});
}

class TextPromptModal extends Modal {
	private resolved = false;
	private value: string;

	constructor(
		app: App,
		private readonly options: { title: string; placeholder?: string; value?: string; submitText: string },
		private readonly resolve: (value: string | null) => void
	) {
		super(app);
		this.value = options.value ?? "";
	}

	onOpen(): void {
		this.titleEl.setText(this.options.title);
		new Setting(this.contentEl).addText((text) => {
			text.setPlaceholder(this.options.placeholder ?? "").setValue(this.value);
			text.onChange((value) => (this.value = value));
			text.inputEl.addClass("mstd-modal-input");
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					this.submit();
				}
			});
			window.setTimeout(() => text.inputEl.select(), 0);
		});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText(this.options.submitText).setCta().onClick(() => this.submit()));
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.resolved) this.resolve(null);
	}

	private submit(): void {
		const trimmed = this.value.trim();
		if (!trimmed) return;
		this.resolved = true;
		this.resolve(trimmed);
		this.close();
	}
}

/**
 * Picks a note to link to a task. The note being edited most recently is
 * offered first, since that is almost always the one people mean.
 */
export class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly preferred: TFile | null,
		private readonly exclude: ReadonlySet<string>,
		private readonly onChoose: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder("Link a note to this task…");
	}

	getItems(): TFile[] {
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => !this.exclude.has(file.path))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
		if (this.preferred && !this.exclude.has(this.preferred.path)) {
			return [this.preferred, ...files.filter((file) => file !== this.preferred)];
		}
		return files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		if (match.item === this.preferred) el.createSpan({ cls: "mstd-suggest-hint", text: "Current note" });
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** Picks the list to move a task to. */
export class ListSuggestModal extends FuzzySuggestModal<TodoTaskList> {
	constructor(
		app: App,
		private readonly lists: TodoTaskList[],
		private readonly onChoose: (list: TodoTaskList) => void
	) {
		super(app);
		this.setPlaceholder("Move to list…");
	}

	getItems(): TodoTaskList[] {
		return this.lists;
	}

	getItemText(list: TodoTaskList): string {
		return list.displayName;
	}

	onChooseItem(list: TodoTaskList): void {
		this.onChoose(list);
	}
}

/** Colour and icon picker for a list. Saves on every click. */
export class ListAppearanceModal extends Modal {
	private color: PaletteColor;
	private icon: string;

	constructor(
		app: App,
		private readonly list: TodoTaskList,
		current: { color: PaletteColor; icon: string },
		private readonly onSave: (appearance: ListAppearance | null) => void
	) {
		super(app);
		this.color = current.color;
		this.icon = current.icon;
	}

	onOpen(): void {
		this.titleEl.setText(`Customise "${this.list.displayName}"`);
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mstd-appearance-modal");

		contentEl.createDiv({ cls: "mstd-appearance-label", text: "Colour" });
		const swatches = contentEl.createDiv({ cls: "mstd-swatches" });
		for (const color of PALETTE) {
			const swatch = swatches.createEl("button", {
				cls: `mstd-swatch${color === this.color ? " is-selected" : ""}`,
				attr: { "aria-label": color, title: color, type: "button" },
			});
			swatch.style.setProperty("--mstd-tint", `var(--color-${color})`);
			swatch.addEventListener("click", () => {
				this.color = color;
				this.save();
			});
		}

		contentEl.createDiv({ cls: "mstd-appearance-label", text: "Icon" });
		const icons = contentEl.createDiv({ cls: "mstd-icon-grid" });
		icons.style.setProperty("--mstd-tint", `var(--color-${this.color})`);
		for (const name of LIST_ICONS) {
			const button = icons.createEl("button", {
				cls: `mstd-icon-choice${name === this.icon ? " is-selected" : ""}`,
				attr: { "aria-label": name, title: name, type: "button" },
			});
			setIcon(button, name);
			button.addEventListener("click", () => {
				this.icon = name;
				this.save();
			});
		}

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText("Reset to default").onClick(() => {
					this.onSave(null);
					this.close();
				})
			)
			.addButton((button) => button.setButtonText("Done").setCta().onClick(() => this.close()));
	}

	private save(): void {
		this.onSave({ color: this.color, icon: this.icon });
		this.render();
	}
}
