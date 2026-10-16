/**
 * A browser stand-in for the parts of the `obsidian` module the plugin's UI
 * imports. The preview build aliases `obsidian` to this file, so the real
 * components, modals and menus run unchanged; only the host is simulated.
 *
 * Markup and class names follow Obsidian's own (`.menu`, `.modal`, `.notice`,
 * `.setting-item`, `.svg-icon`) so `preview.css` can style them the same way.
 * Only what the UI uses is implemented - esbuild fails the preview build if a
 * component starts importing something missing here, which is the cue to add it.
 */
import * as lucide from "lucide";

/* -------------------------------------------------------------------------- */
/* DOM helpers Obsidian adds to every element                                 */
/* -------------------------------------------------------------------------- */

interface ElOptions {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	type?: string;
	placeholder?: string;
	value?: string;
}

function applyOptions(el: HTMLElement, options?: ElOptions | string): void {
	if (!options) return;
	if (typeof options === "string") {
		el.className = options;
		return;
	}
	if (options.cls) el.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
	if (options.text !== undefined) el.textContent = options.text;
	if (options.type) el.setAttribute("type", options.type);
	if (options.placeholder) el.setAttribute("placeholder", options.placeholder);
	if (options.value !== undefined) (el as HTMLInputElement).value = options.value;
	for (const [key, value] of Object.entries(options.attr ?? {})) {
		if (value === null || value === false) continue;
		el.setAttribute(key, String(value));
	}
}

// Typed loosely on purpose: Obsidian's declarations already describe these.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

proto.createEl = function (this: HTMLElement, tag: string, options?: ElOptions | string, callback?: (el: HTMLElement) => void) {
	const el = document.createElement(tag);
	applyOptions(el, options);
	this.appendChild(el);
	callback?.(el);
	return el;
};
proto.createDiv = function (this: HTMLElement, options?: ElOptions | string) {
	return (this as unknown as { createEl: (tag: string, o?: ElOptions | string) => HTMLElement }).createEl("div", options);
};
proto.createSpan = function (this: HTMLElement, options?: ElOptions | string) {
	return (this as unknown as { createEl: (tag: string, o?: ElOptions | string) => HTMLElement }).createEl("span", options);
};
proto.empty = function (this: HTMLElement) {
	this.replaceChildren();
};
proto.setText = function (this: HTMLElement, text: string) {
	this.textContent = text;
};
proto.addClass = function (this: HTMLElement, ...classes: string[]) {
	this.classList.add(...classes);
};
proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
	this.classList.remove(...classes);
};
proto.toggleClass = function (this: HTMLElement, cls: string, value: boolean) {
	this.classList.toggle(cls, value);
};
proto.setAttr = function (this: HTMLElement, name: string, value: string | number | boolean | null) {
	if (value === null || value === false) this.removeAttribute(name);
	else this.setAttribute(name, String(value));
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (cls) node.className = cls;
	parent?.appendChild(node);
	return node;
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

type IconNode = [string, Record<string, string | number>][];

function pascalCase(name: string): string {
	return name
		.replace(/^lucide-/, "")
		.split("-")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

/** Obsidian's icons are Lucide, so the preview draws from the same set. */
export function setIcon(parent: HTMLElement, iconId: string): void {
	parent.replaceChildren();
	const node = (lucide as unknown as Record<string, IconNode | undefined>)[pascalCase(iconId)];
	if (!Array.isArray(node)) {
		console.warn(`[preview] Unknown icon "${iconId}"`);
		return;
	}
	const svg = lucide.createElement(node as Parameters<typeof lucide.createElement>[0]);
	svg.setAttribute("class", `svg-icon lucide-${iconId}`);
	parent.appendChild(svg);
}

/* -------------------------------------------------------------------------- */
/* Platform                                                                   */
/* -------------------------------------------------------------------------- */

const mac = /Mac|iPhone|iPad/.test(navigator.platform);

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isMacOS: mac,
	isWin: !mac,
	isLinux: false,
	isPhone: false,
	isTablet: false,
};

/* -------------------------------------------------------------------------- */
/* Notice                                                                     */
/* -------------------------------------------------------------------------- */

function noticeContainer(): HTMLElement {
	return document.querySelector<HTMLElement>(".notice-container") ?? el("div", "notice-container", document.body);
}

export class Notice {
	noticeEl: HTMLElement;
	private timer: number | undefined;

	constructor(message: string | DocumentFragment, duration = 4000) {
		this.noticeEl = el("div", "notice");
		if (typeof message === "string") this.noticeEl.textContent = message;
		else this.noticeEl.appendChild(message);
		this.noticeEl.addEventListener("click", () => this.hide());
		noticeContainer().appendChild(this.noticeEl);
		if (duration > 0) this.timer = window.setTimeout(() => this.hide(), duration);
	}

	setMessage(message: string | DocumentFragment): this {
		this.noticeEl.replaceChildren(message);
		return this;
	}

	hide(): void {
		window.clearTimeout(this.timer);
		this.noticeEl.remove();
	}
}

/* -------------------------------------------------------------------------- */
/* Menu                                                                       */
/* -------------------------------------------------------------------------- */

export class MenuItem {
	readonly dom = el("div", "menu-item");
	private readonly iconEl = el("div", "menu-item-icon", this.dom);
	private readonly titleEl = el("div", "menu-item-title", this.dom);
	private handler: ((event: MouseEvent | KeyboardEvent) => unknown) | null = null;
	disabled = false;

	constructor(private readonly menu: Menu) {
		this.dom.addEventListener("click", (event) => {
			if (this.disabled || this.dom.classList.contains("is-label")) return;
			this.menu.hide();
			this.handler?.(event);
		});
	}

	setTitle(title: string | DocumentFragment): this {
		this.titleEl.replaceChildren(title);
		return this;
	}
	setIcon(icon: string | null): this {
		if (icon) setIcon(this.iconEl, icon);
		else this.iconEl.replaceChildren();
		return this;
	}
	setChecked(checked: boolean | null): this {
		this.dom.querySelector(".menu-item-checked")?.remove();
		if (checked) setIcon(el("div", "menu-item-icon menu-item-checked", this.dom), "check");
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.dom.classList.toggle("is-disabled", disabled);
		return this;
	}
	setWarning(warning: boolean): this {
		this.dom.classList.toggle("is-warning", warning);
		return this;
	}
	setIsLabel(label: boolean): this {
		this.dom.classList.toggle("is-label", label);
		return this;
	}
	setSection(): this {
		return this;
	}
	onClick(handler: (event: MouseEvent | KeyboardEvent) => unknown): this {
		this.handler = handler;
		return this;
	}
}

export class Menu {
	readonly dom = el("div", "menu");
	private readonly dismiss = (event: Event): void => {
		if (event instanceof KeyboardEvent && event.key !== "Escape") return;
		if (event instanceof MouseEvent && this.dom.contains(event.target as Node)) return;
		this.hide();
	};

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem(this);
		callback(item);
		this.dom.appendChild(item.dom);
		return this;
	}

	addSeparator(): this {
		el("div", "menu-separator", this.dom);
		return this;
	}

	showAtMouseEvent(event: MouseEvent): this {
		return this.showAtPosition({ x: event.clientX, y: event.clientY });
	}

	showAtPosition(position: { x: number; y: number }): this {
		document.body.appendChild(this.dom);
		// Keep the menu on screen, flipping above or left of the pointer if needed.
		const { offsetWidth: width, offsetHeight: height } = this.dom;
		const x = position.x + width > window.innerWidth ? Math.max(4, position.x - width) : position.x;
		const y = position.y + height > window.innerHeight ? Math.max(4, position.y - height) : position.y;
		this.dom.style.left = `${x}px`;
		this.dom.style.top = `${y}px`;
		window.setTimeout(() => {
			document.addEventListener("mousedown", this.dismiss, true);
			document.addEventListener("keydown", this.dismiss, true);
		}, 0);
		return this;
	}

	hide(): this {
		document.removeEventListener("mousedown", this.dismiss, true);
		document.removeEventListener("keydown", this.dismiss, true);
		this.dom.remove();
		return this;
	}
}

/* -------------------------------------------------------------------------- */
/* Files                                                                      */
/* -------------------------------------------------------------------------- */

export class TAbstractFile {
	constructor(public path: string) {}
	get name(): string {
		return this.path.split("/").pop() ?? this.path;
	}
}

export class TFile extends TAbstractFile {
	stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
	get basename(): string {
		return this.name.replace(/\.[^.]+$/, "");
	}
	get extension(): string {
		return this.name.split(".").pop() ?? "";
	}
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                     */
/* -------------------------------------------------------------------------- */

/** The preview's `App` is a plain object; see `preview-host.ts`. */
type App = unknown;

export class Modal {
	readonly containerEl = el("div", "modal-container");
	readonly modalEl: HTMLElement;
	readonly titleEl: HTMLElement;
	readonly contentEl: HTMLElement;
	private readonly onKey = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.stopPropagation();
			this.close();
		}
	};

	constructor(public app: App) {
		el("div", "modal-bg", this.containerEl).addEventListener("click", () => this.close());
		this.modalEl = el("div", "modal", this.containerEl);
		const close = el("div", "modal-close-button", this.modalEl);
		setIcon(close, "x");
		close.addEventListener("click", () => this.close());
		this.titleEl = el("div", "modal-title", this.modalEl);
		this.contentEl = el("div", "modal-content", this.modalEl);
	}

	open(): void {
		document.body.appendChild(this.containerEl);
		document.addEventListener("keydown", this.onKey, true);
		this.onOpen();
	}

	close(): void {
		document.removeEventListener("keydown", this.onKey, true);
		this.containerEl.remove();
		this.onClose();
	}

	setTitle(title: string): this {
		this.titleEl.textContent = title;
		return this;
	}

	onOpen(): void {}
	onClose(): void {}
}

export interface FuzzyMatch<T> {
	item: T;
	match: { score: number; matches: [number, number][] };
}

/** A filterable list in a prompt, like the Quick Switcher. Substring match only. */
export abstract class FuzzySuggestModal<T> extends Modal {
	readonly inputEl: HTMLInputElement;
	private readonly resultsEl: HTMLElement;
	private matches: FuzzyMatch<T>[] = [];
	private selected = 0;

	constructor(app: App) {
		super(app);
		this.modalEl.className = "prompt";
		this.titleEl.remove();
		this.inputEl = el("input", "prompt-input", this.modalEl);
		this.inputEl.type = "text";
		this.resultsEl = el("div", "prompt-results", this.modalEl);
		this.contentEl.remove();
		this.inputEl.addEventListener("input", () => this.update());
		this.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				this.selected = (this.selected + step + this.matches.length) % Math.max(1, this.matches.length);
				this.paint();
			} else if (event.key === "Enter") {
				event.preventDefault();
				this.choose(this.matches[this.selected]);
			}
		});
	}

	setPlaceholder(placeholder: string): void {
		this.inputEl.placeholder = placeholder;
	}

	open(): void {
		super.open();
		this.update();
		this.inputEl.focus();
	}

	abstract getItems(): T[];
	abstract getItemText(item: T): string;
	abstract onChooseItem(item: T, event: MouseEvent | KeyboardEvent): void;

	renderSuggestion(match: FuzzyMatch<T>, target: HTMLElement): void {
		target.createSpan({ text: this.getItemText(match.item) });
	}

	private update(): void {
		const query = this.inputEl.value.trim().toLowerCase();
		this.matches = this.getItems()
			.filter((item) => this.getItemText(item).toLowerCase().includes(query))
			.map((item) => ({ item, match: { score: 0, matches: [] } }));
		this.selected = 0;
		this.paint();
	}

	private paint(): void {
		this.resultsEl.replaceChildren();
		if (this.matches.length === 0) {
			el("div", "suggestion-empty", this.resultsEl).textContent = "No match.";
			return;
		}
		this.matches.forEach((match, index) => {
			const row = el("div", `suggestion-item${index === this.selected ? " is-selected" : ""}`, this.resultsEl);
			this.renderSuggestion(match, row);
			row.addEventListener("mouseenter", () => {
				this.selected = index;
				this.paint();
			});
			row.addEventListener("click", () => this.choose(match));
		});
	}

	private choose(match: FuzzyMatch<T> | undefined): void {
		if (!match) return;
		this.close();
		this.onChooseItem(match.item, new MouseEvent("click"));
	}
}

/* -------------------------------------------------------------------------- */
/* Setting rows                                                               */
/* -------------------------------------------------------------------------- */

class ButtonComponent {
	readonly buttonEl: HTMLButtonElement;
	constructor(parent: HTMLElement) {
		this.buttonEl = el("button", "", parent);
		this.buttonEl.type = "button";
	}
	setButtonText(text: string): this {
		this.buttonEl.textContent = text;
		return this;
	}
	setCta(): this {
		this.buttonEl.classList.add("mod-cta");
		return this;
	}
	setWarning(): this {
		this.buttonEl.classList.add("mod-warning");
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.buttonEl.disabled = disabled;
		return this;
	}
	onClick(handler: (event: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener("click", handler);
		return this;
	}
}

class TextComponent {
	readonly inputEl: HTMLInputElement;
	constructor(parent: HTMLElement) {
		this.inputEl = el("input", "", parent);
		this.inputEl.type = "text";
	}
	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
	onChange(handler: (value: string) => unknown): this {
		this.inputEl.addEventListener("input", () => handler(this.inputEl.value));
		return this;
	}
}

export class Setting {
	readonly settingEl: HTMLElement;
	readonly infoEl: HTMLElement;
	readonly nameEl: HTMLElement;
	readonly descEl: HTMLElement;
	readonly controlEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = el("div", "setting-item", containerEl);
		this.infoEl = el("div", "setting-item-info", this.settingEl);
		this.nameEl = el("div", "setting-item-name", this.infoEl);
		this.descEl = el("div", "setting-item-description", this.infoEl);
		this.controlEl = el("div", "setting-item-control", this.settingEl);
	}

	setName(name: string): this {
		this.nameEl.textContent = name;
		return this;
	}
	setDesc(desc: string): this {
		this.descEl.textContent = desc;
		return this;
	}
	setHeading(): this {
		this.settingEl.classList.add("setting-item-heading");
		return this;
	}
	addButton(callback: (button: ButtonComponent) => unknown): this {
		callback(new ButtonComponent(this.controlEl));
		return this;
	}
	addText(callback: (text: TextComponent) => unknown): this {
		callback(new TextComponent(this.controlEl));
		return this;
	}
}

/* -------------------------------------------------------------------------- */
/* Loaded but never shown                                                     */
/* -------------------------------------------------------------------------- */

/** The settings module extends this at import time; the preview never opens it. */
export class PluginSettingTab {
	readonly containerEl = document.createElement("div");
	constructor(
		public app: App,
		public plugin: unknown
	) {}
	display(): void {}
	hide(): void {}
}
