import { App, Modal, Setting } from 'obsidian';
import { TrainerColor } from 'src/lib/trainer';

/**
 * Asks which side to train before a session starts. Closing the modal without
 * choosing simply does not start one.
 */
export class ColorChoiceModal extends Modal {
	constructor(
		app: App,
		private options: {
			body: string;
			onChoose: (color: TrainerColor) => void;
		}
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h3', { text: 'Which colour do you want to play?' });
		contentEl.createEl('p', { text: this.options.body });

		const choose = (color: TrainerColor) => {
			this.close();
			this.options.onChoose(color);
		};

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText('Black').onClick(() => choose('black'))
			)
			.addButton((btn) =>
				btn
					.setButtonText('White')
					.setCta()
					.onClick(() => choose('white'))
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}
