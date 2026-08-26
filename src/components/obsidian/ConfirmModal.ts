import { App, Modal, Setting } from 'obsidian';

/**
 * Deleting a variation removes a whole subtree, there is no undo, and autosave
 * commits it moments later - so it asks first.
 */
export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private options: {
			title: string;
			body: string;
			confirmText: string;
			onConfirm: () => void;
		}
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h3', { text: this.options.title });
		contentEl.createEl('p', { text: this.options.body });

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText(this.options.confirmText)
					// Deprecated in favour of `setDestructive`, which is 1.13 only.
					// Swapping it would break every Obsidian this plugin still
					// supports, so it stays until `minAppVersion` moves.
					.setWarning()
					.onClick(() => {
						this.close();
						this.options.onConfirm();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
