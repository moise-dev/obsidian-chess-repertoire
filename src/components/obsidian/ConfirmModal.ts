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
			/**
			 * What exactly is about to go, one line each, behind a disclosure.
			 *
			 * A count on its own is not something anyone can say yes to when the
			 * things being counted are files named by an id - but the list is long
			 * and most of the time nobody reads it, so it starts closed and the
			 * question stays the first thing in the window.
			 */
			details?: { summary: string; items: string[] };
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

		if (this.options.details?.items.length) {
			const disclosure = contentEl.createEl('details', {
				cls: 'cs-confirm-details',
			});

			disclosure.createEl('summary', { text: this.options.details.summary });

			const list = disclosure.createEl('ul');

			for (const item of this.options.details.items)
				list.createEl('li', { text: item });
		}

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText(this.options.confirmText)
					.setDestructive()
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
