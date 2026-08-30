import { App, Modal, Setting } from 'obsidian';
import { TrainerColor } from 'src/lib/trainer';

/** The colour as it is written in a sentence, matching the buttons. */
const label = (color: TrainerColor): string =>
	color === 'black' ? 'Black' : 'White';

/**
 * Asks which side to train before a session starts. Closing the modal without
 * choosing simply does not start one.
 */
export class ColorChoiceModal extends Modal {
	constructor(
		app: App,
		private options: {
			body: string;
			/** The repertoire's own colour, if it has said. Offered as the default. */
			current?: TrainerColor;
			onChoose: (color: TrainerColor) => void;
		}
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h3', { text: 'Which colour would you like to play?' });
		contentEl.createEl('p', { text: this.options.body });

		const choose = (color: TrainerColor) => {
			this.close();
			this.options.onChoose(color);
		};

		// The repertoire's own colour is the call to action; with nothing recorded the
		// emphasis falls on White, as it did before repertoires had a colour.
		const preferred = this.options.current ?? 'white';

		// Said in words as well as in emphasis: which button is the primary one is
		// a matter of shade in some themes, and the suggestion is the whole reason
		// a repertoire records the side it is written for.
		contentEl.createEl('p', {
			cls: 'cs-color-choice-suggestion',
			text: this.options.current
				? `The suggested one is ${label(
						preferred
				  )}, the side this repertoire is written for.`
				: `The suggested one is ${label(
						preferred
				  )}. This repertoire has not said which side it is written for, and answering here records it.`,
		});

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
