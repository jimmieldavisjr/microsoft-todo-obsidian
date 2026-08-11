import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type MicrosoftTodoPlugin from "../main";
import type { ListSelection } from "../types/microsoft-todo";
import type { StoredAuthSession } from "../auth/MicrosoftAuth";
import { describeError } from "../errors";

export type DefaultView = "last" | "myDay" | "important" | "defaultList";
export type NoteLinkStyle = "uri" | "path";

export interface MicrosoftTodoSettings {
	/* Azure app registration */
	clientId: string;
	tenantId: string;

	/* Persisted session (written by MicrosoftAuth, not by the settings tab) */
	auth: StoredAuthSession | null;

	/* Behaviour */
	defaultListId: string;
	defaultView: DefaultView;
	lastSelection: ListSelection | null;
	openOnStartup: boolean;
	refreshOnOpen: boolean;
	autoRefreshMinutes: number;
	showCompleted: boolean;
	showListCounts: boolean;

	/* Obsidian integration */
	addNoteLink: boolean;
	noteLinkStyle: NoteLinkStyle;
	selectedTextListId: string;
	currentNoteListId: string;
}

/**
 * The app registration this plugin ships with, so signing in is just "click
 * Connect and type the code" - no Azure portal trip.
 *
 * A client ID is not a secret: OAuth public clients are designed to embed one,
 * and it grants nothing on its own. Every user still signs in as themselves and
 * consents individually, and the token never leaves their machine.
 *
 * Users in tenants that block unapproved third-party apps can point the plugin
 * at their own registration in settings.
 */
export const BUNDLED_CLIENT_ID = "305576c8-1eba-486b-bb1f-351b29a78dde";

/**
 * Client IDs this plugin has shipped as its default in the past.
 *
 * Settings are persisted whole, so the bundled ID gets written into every
 * user's `data.json` on first save - and a saved value beats a new default.
 * Without this list, changing the bundled registration would silently strand
 * every existing install on the old one.
 *
 * A saved ID that appears here came from us rather than the user, so it is safe
 * to move forward. Anything else is somebody's own registration; leave it alone.
 */
export const SUPERSEDED_CLIENT_IDS: readonly string[] = [
	// Empty while BUNDLED_CLIENT_ID is the first registration ever shipped.
	// When it changes, move the previous value here so existing installs follow.
];

export const DEFAULT_SETTINGS: MicrosoftTodoSettings = {
	clientId: BUNDLED_CLIENT_ID,
	tenantId: "common",
	auth: null,

	defaultListId: "",
	defaultView: "last",
	lastSelection: null,
	openOnStartup: false,
	refreshOnOpen: true,
	autoRefreshMinutes: 0,
	showCompleted: false,
	showListCounts: true,

	addNoteLink: true,
	noteLinkStyle: "uri",
	selectedTextListId: "",
	currentNoteListId: "",
};

const AZURE_PORTAL_URL = "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";

export class MicrosoftTodoSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: MicrosoftTodoPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderAccountSection(containerEl);
		this.renderBehaviourSection(containerEl);
		this.renderIntegrationSection(containerEl);
	}

	/* ---------------------------------------------------------------------- */

	private renderAccountSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Microsoft account").setHeading();

		const auth = this.plugin.auth;
		const status = containerEl.createDiv({ cls: "mstd-settings-status" });

		if (!auth.isConfigured) {
			status.addClass("mstd-settings-status--warning");
			status.setText("Not configured - add an Azure application (client) ID below.");
		} else if (!auth.isSignedIn && this.plugin.settings.clientId === BUNDLED_CLIENT_ID) {
			status.setText("Not connected. Select Connect Microsoft account to sign in.");
		} else if (auth.isSignedIn) {
			status.addClass("mstd-settings-status--ok");
			const account = auth.account;
			status.setText(`Connected as ${account?.name ?? "your Microsoft account"}${account?.username && account.username !== account.name ? ` (${account.username})` : ""}.`);
		} else {
			status.setText("Not connected.");
		}

		new Setting(containerEl)
			.setName("Application (client) ID")
			.setDesc(
				createFragment((frag) => {
					frag.appendText("Optional. The plugin ships with one, so most people never need this. ");
					frag.appendText("If your organisation blocks unapproved apps, register your own at ");
					frag.createEl("a", { text: "Azure Portal → App registrations", href: AZURE_PORTAL_URL });
					frag.appendText(" with ");
					frag.createEl("strong", { text: "Allow public client flows" });
					frag.appendText(" enabled and the delegated ");
					frag.createEl("code", { text: "Tasks.ReadWrite" });
					frag.appendText(" permission, then paste its ID here. Clear the field to go back to the default.");
				})
			)
			.addText((text) =>
				text
					.setPlaceholder(BUNDLED_CLIENT_ID)
					.setValue(
						// Show the field empty while it's on the shipped default, so it
						// reads as "nothing to do here" rather than a value to preserve.
						this.plugin.settings.clientId === BUNDLED_CLIENT_ID ? "" : this.plugin.settings.clientId
					)
					.onChange(async (value) => {
						const trimmed = value.trim() || BUNDLED_CLIENT_ID;
						if (trimmed === this.plugin.settings.clientId) return;
						this.plugin.settings.clientId = trimmed;
						await this.plugin.saveSettings();
						// Tokens belong to the old app registration - drop them.
						await this.plugin.handleAuthConfigChanged();
					})
			);

		new Setting(containerEl)
			.setName("Directory (tenant)")
			.setDesc(
				"Optional. 'common' accepts both personal and work accounts and suits almost everyone. Use " +
					"'consumers' for personal Microsoft accounts only, 'organizations' for work/school only, or a " +
					"specific tenant ID."
			)
			.addText((text) =>
				text
					.setPlaceholder("common")
					.setValue(this.plugin.settings.tenantId)
					.onChange(async (value) => {
						const trimmed = value.trim() || "common";
						if (trimmed === this.plugin.settings.tenantId) return;
						this.plugin.settings.tenantId = trimmed;
						await this.plugin.saveSettings();
						await this.plugin.handleAuthConfigChanged();
					})
			);

		new Setting(containerEl)
			.setName("Connection")
			.setDesc(
				auth.isSignedIn
					? "Disconnecting removes the stored sign-in from this vault."
					: "Opens a Microsoft sign-in code you enter in your browser."
			)
			.addButton((button) => {
				if (auth.isSignedIn) {
					button
						.setButtonText("Disconnect")
						.setWarning()
						.onClick(async () => {
							await this.plugin.signOut();
							this.display();
						});
				} else {
					button
						.setButtonText("Connect Microsoft account")
						.setCta()
						.setDisabled(!auth.isConfigured)
						.onClick(async () => {
							await this.plugin.signIn();
							this.display();
						});
				}
			});
	}

	/* ---------------------------------------------------------------------- */

	private renderBehaviourSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Behaviour").setHeading();

		new Setting(containerEl)
			.setName("Default view")
			.setDesc("Which list the panel opens on.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						last: "Last used",
						myDay: "My Day",
						important: "Important",
						defaultList: "Default list (below)",
					})
					.setValue(this.plugin.settings.defaultView)
					.onChange(async (value) => {
						this.plugin.settings.defaultView = value as DefaultView;
						await this.plugin.saveSettings();
					})
			);

		this.addListDropdown(containerEl, {
			name: "Default list",
			desc: "Used for the default view, and for new tasks created from the Command Palette.",
			value: this.plugin.settings.defaultListId,
			emptyLabel: "First list in Microsoft To Do",
			onChange: async (value) => {
				this.plugin.settings.defaultListId = value;
				await this.plugin.saveSettings();
			},
		});

		new Setting(containerEl)
			.setName("Open Microsoft To Do on startup")
			.setDesc("Reveal the panel in the sidebar when Obsidian loads. Combine with a default view of My Day to open straight into My Day.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openOnStartup).onChange(async (value) => {
					this.plugin.settings.openOnStartup = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Refresh when the panel opens")
			.setDesc("Fetch the latest tasks each time the view is opened or revealed.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.refreshOnOpen).onChange(async (value) => {
					this.plugin.settings.refreshOnOpen = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Auto-refresh")
			.setDesc("How often to refresh in the background while the panel is open.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"0": "Off (manual refresh only)",
						"5": "Every 5 minutes",
						"15": "Every 15 minutes",
						"30": "Every 30 minutes",
						"60": "Every hour",
					})
					.setValue(String(this.plugin.settings.autoRefreshMinutes))
					.onChange(async (value) => {
						this.plugin.settings.autoRefreshMinutes = Number(value);
						await this.plugin.saveSettings();
						this.plugin.restartAutoRefresh();
					})
			);

		new Setting(containerEl)
			.setName("Load completed tasks")
			.setDesc(
				"Fetch completed tasks from Microsoft To Do when refreshing. Tasks you complete inside Obsidian stay visible until the next refresh either way."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showCompleted).onChange(async (value) => {
					this.plugin.settings.showCompleted = value;
					await this.plugin.saveSettings();
					await this.plugin.taskService.setShowCompleted(value);
				})
			);

		new Setting(containerEl)
			.setName("Show task counts in the list sidebar")
			.setDesc(
				"Loads every list on refresh so counts, My Day and Important stay accurate. Turn this off if you have a large number of lists and want fewer requests."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showListCounts).onChange(async (value) => {
					this.plugin.settings.showListCounts = value;
					await this.plugin.saveSettings();
					this.plugin.taskService.notifySettingsChanged();
				})
			);
	}

	/* ---------------------------------------------------------------------- */

	private renderIntegrationSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Obsidian integration").setHeading();

		new Setting(containerEl)
			.setName("Add a link back to the note")
			.setDesc("When creating a task from a note or selection, append a link to the source note in the task's notes field.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.addNoteLink).onChange(async (value) => {
					this.plugin.settings.addNoteLink = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.settings.addNoteLink) {
			new Setting(containerEl)
				.setName("Link style")
				.setDesc(
					"An obsidian:// URI is clickable from the Microsoft To Do apps and opens the note directly. A vault path is plain text."
				)
				.addDropdown((dropdown) =>
					dropdown
						.addOptions({
							uri: "obsidian:// link (clickable)",
							path: "Vault path (plain text)",
						})
						.setValue(this.plugin.settings.noteLinkStyle)
						.onChange(async (value) => {
							this.plugin.settings.noteLinkStyle = value as NoteLinkStyle;
							await this.plugin.saveSettings();
						})
				);
		}

		this.addListDropdown(containerEl, {
			name: "List for selected text",
			desc: "Where 'Add selected text as task' sends new tasks.",
			value: this.plugin.settings.selectedTextListId,
			emptyLabel: "Use default list",
			onChange: async (value) => {
				this.plugin.settings.selectedTextListId = value;
				await this.plugin.saveSettings();
			},
		});

		this.addListDropdown(containerEl, {
			name: "List for the current note",
			desc: "Where 'Add current note as task' sends new tasks.",
			value: this.plugin.settings.currentNoteListId,
			emptyLabel: "Use default list",
			onChange: async (value) => {
				this.plugin.settings.currentNoteListId = value;
				await this.plugin.saveSettings();
			},
		});
	}

	/* ---------------------------------------------------------------------- */

	/**
	 * A list picker backed by whatever lists the service has already loaded.
	 * Falls back to a read-only hint when nothing is cached yet, so the settings
	 * tab never blocks on a network call.
	 */
	private addListDropdown(
		containerEl: HTMLElement,
		options: {
			name: string;
			desc: string;
			value: string;
			emptyLabel: string;
			onChange: (value: string) => Promise<void>;
		}
	): void {
		const lists = this.plugin.taskService.getState().lists;
		const setting = new Setting(containerEl).setName(options.name).setDesc(options.desc);

		if (lists.length === 0) {
			setting.addButton((button) =>
				button
					.setButtonText(this.plugin.auth.isSignedIn ? "Load lists" : "Connect first")
					.setDisabled(!this.plugin.auth.isSignedIn)
					.onClick(async () => {
						try {
							await this.plugin.taskService.refresh({ force: true });
						} catch (error) {
							new Notice(describeError(error));
						}
						this.display();
					})
			);
			return;
		}

		setting.addDropdown((dropdown) => {
			dropdown.addOption("", options.emptyLabel);
			for (const list of lists) dropdown.addOption(list.id, list.displayName);
			// A previously chosen list may have been deleted in To Do.
			const known = options.value === "" || lists.some((list) => list.id === options.value);
			dropdown.setValue(known ? options.value : "");
			dropdown.onChange(options.onChange);
		});
	}
}
