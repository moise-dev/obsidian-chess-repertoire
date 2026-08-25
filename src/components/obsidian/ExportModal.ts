import { App, Modal, Notice, Setting, TextAreaComponent } from 'obsidian';

export type ExportFormat = 'pgn' | 'fen';

/**
 * Shows the study as PGN or FEN and copies whichever is showing. The two are
 * computed once up front rather than re-derived on toggle - a FEN is just the
 * current position, but a PGN walks the whole move tree, and neither is worth
 * doing twice.
 */
export class ExportModal extends Modal {
	private format: ExportFormat;
	private textArea: TextAreaComponent;

	constructor(app: App, private content: Record<ExportFormat, string>) {
		super(app);
		this.format = 'pgn';
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl('h3', { text: 'Export study' });

		let pgnButton: HTMLButtonElement;
		let fenButton: HTMLButtonElement;

		const select = (format: ExportFormat) => {
			this.format = format;
			this.textArea.setValue(this.content[format]);
			pgnButton.toggleClass('mod-cta', format === 'pgn');
			fenButton.toggleClass('mod-cta', format === 'fen');
		};

		new Setting(contentEl)
			.addButton((btn) => {
				pgnButton = btn.setButtonText('PGN').onClick(() => select('pgn')).buttonEl;
			})
			.addButton((btn) => {
				fenButton = btn.setButtonText('FEN').onClick(() => select('fen')).buttonEl;
			});

		new Setting(contentEl).addTextArea((text) => {
			this.textArea = text;
			text.inputEl.setCssStyles({ width: '100%', height: '250px' });
			text.inputEl.readOnly = true;
		});

		select(this.format);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText('Copy to clipboard')
				.setCta()
				.onClick(async () => {
					try {
						await navigator.clipboard.writeText(this.content[this.format]);
						new Notice('Copied to clipboard!');
					} catch (e) {
						new Notice(`Could not copy to clipboard: ${e}`);
					}
				})
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}
