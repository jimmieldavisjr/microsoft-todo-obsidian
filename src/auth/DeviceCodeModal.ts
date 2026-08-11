import { App, Modal, Notice, Setting } from "obsidian";
import type { AccountInfo, DeviceCodePrompt } from "./MicrosoftAuth";

/**
 * Walks the user through the device code flow: shows the code, gets them to the
 * Microsoft sign-in page, and waits.
 *
 * Closing the modal cancels the sign-in via `onCancel`, so an abandoned attempt
 * doesn't leave a polling loop running in the background.
 */
export class DeviceCodeModal extends Modal {
	private settled = false;

	constructor(app: App, private readonly onCancel: () => void) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("Connect Microsoft account");
		this.renderWaiting();
	}

	onClose(): void {
		this.contentEl.empty();
		// Only a close *before* success should abort the flow.
		if (!this.settled) this.onCancel();
	}

	private renderWaiting(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", { text: "Contacting Microsoft…" });
	}

	showPrompt(prompt: DeviceCodePrompt): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("p", {
			text: "Open the Microsoft sign-in page and enter this code:",
		});

		const codeEl = contentEl.createDiv({ cls: "mstd-device-code" });
		codeEl.setText(prompt.userCode);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText("Copy code")
					.onClick(async () => {
						try {
							await navigator.clipboard.writeText(prompt.userCode);
							new Notice("Code copied to clipboard.");
						} catch {
							new Notice("Could not copy automatically - select the code and copy it manually.");
						}
					})
			)
			.addButton((button) =>
				button
					.setButtonText("Open sign-in page")
					.setCta()
					.onClick(() => window.open(prompt.verificationUri, "_blank"))
			);

		const url = contentEl.createEl("p", { cls: "mstd-device-hint" });
		url.appendText("Sign-in page: ");
		url.createEl("a", { text: prompt.verificationUri, href: prompt.verificationUri });

		contentEl.createEl("p", {
			cls: "mstd-device-hint",
			text: `This code expires at ${new Date(prompt.expiresAt).toLocaleTimeString()}. This window closes automatically once you're signed in.`,
		});
	}

	showSuccess(account: AccountInfo): void {
		this.settled = true;
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("p", { text: `Connected as ${account.name}.` });
		window.setTimeout(() => this.close(), 1200);
	}

	/** Closes without triggering cancellation - the caller already has the error. */
	dismiss(): void {
		this.settled = true;
		this.close();
	}
}
