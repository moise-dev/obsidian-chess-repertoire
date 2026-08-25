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
			/** The study's own colour, if it has said. Offered as the default. */
			current?: TrainerColor;
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

		// The study's own colour is the call to action; with nothing recorded the
		// emphasis falls on White, as it did before studies had a colour.
		const preferred = this.options.current ?? 'white';

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText('Black').onClick(() => choose('black'));

				if (preferred === 'black') btn.setCta();
			})
			.addButton((btn) => {
				btn.setButtonText('White').onClick(() => choose('white'));

				if (preferred === 'white') btn.setCta();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
