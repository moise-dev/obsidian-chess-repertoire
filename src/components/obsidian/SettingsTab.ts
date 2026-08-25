import { App, PluginSettingTab, Setting } from 'obsidian';
import ChessRepertoirePlugin from 'src/main';

export const BOARD_COLORS = {
	blue: 'Blue',
	'blue-soft': 'Blue (soft)',
	green: 'Green',
	brown: 'Brown',
} as const;

export type BoardColor = keyof typeof BOARD_COLORS;

export interface ChessRepertoirePluginSettings {
	boardOrientation: 'white' | 'black';
	boardColor: BoardColor;
	viewComments: true | false;
	/** Width of the widget in px. `null` means "fill the available width". */
	boardSize: number | null;
	showCoordinates: true | false;
	/**
	 * Colour of the a-h / 1-8 labels, as a hex string. Empty means "follow the
	 * theme", which is the right answer for most vaults and the default.
	 */
	coordinateColor: string;
}

export const DEFAULT_SETTINGS: ChessRepertoirePluginSettings = {
	boardOrientation: 'white',
	boardColor: 'blue',
	viewComments: true,
	boardSize: null,
	showCoordinates: true,
	coordinateColor: '',
};

/**
 * The theme's muted text colour, resolved to something the colour picker can
 * show. It only understands hex, and `--text-muted` is usually an rgb() or a
 * var chain, so it is measured off a throwaway element rather than read.
 */
const themeMutedColor = (): string => {
	const probe = document.body.createDiv();
	probe.style.color = 'var(--text-muted)';

	const match = getComputedStyle(probe)
		.color.match(/\d+/g)
		?.slice(0, 3)
		.map((part) => Number(part).toString(16).padStart(2, '0'));

	probe.remove();

	return match ? `#${match.join('')}` : '#888888';
};

export class SettingsTab extends PluginSettingTab {
	plugin: ChessRepertoirePlugin;

	constructor(app: App, plugin: ChessRepertoirePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Board orientation')
			.setDesc('Sets the default orientation of the board')
			.addDropdown((dropdown) => {
				dropdown.addOption('white', 'White');
				dropdown.addOption('black', 'Black');

				dropdown
					.setValue(this.plugin.settings.boardOrientation)
					.onChange((orientation) => {
						this.plugin.settings.boardOrientation = orientation as 'white' | 'black';
						this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Board color')
			.setDesc('Sets the default color of the board')
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(BOARD_COLORS)) {
					dropdown.addOption(value, label);
				}

				dropdown
					.setValue(this.plugin.settings.boardColor)
					.onChange((boardColor) => {
						this.plugin.settings.boardColor = boardColor as BoardColor;
						this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Board coordinates')
			.setDesc('Show the a-h / 1-8 labels on the board')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showCoordinates)
					.onChange((showCoordinates) => {
						this.plugin.settings.showCoordinates = showCoordinates;
						this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Coordinate color')
			.setDesc(
				"Color of the coordinate labels. Reset to follow the theme's muted text color."
			)
			.addColorPicker((picker) => {
				// The picker has no empty state, so it shows what the labels
				// currently look like: the chosen colour, or the theme's own.
				picker
					.setValue(this.plugin.settings.coordinateColor || themeMutedColor())
					.onChange((coordinateColor) => {
						this.plugin.settings.coordinateColor = coordinateColor;
						this.plugin.saveSettings();
					});
			})
			.addExtraButton((button) => {
				button
					.setIcon('rotate-ccw')
					.setTooltip('Follow the theme')
					.onClick(() => {
						this.plugin.settings.coordinateColor = '';
						this.plugin.saveSettings();
						// Redraw so the picker falls back to the theme's colour.
						this.display();
					});
			});

		new Setting(containerEl)
			.setName('Default width')
			.setDesc(
				'Default width of the widget in pixels. Leave empty to fill the width of the note. Individual repertoires can be resized by dragging their bottom-right corner.'
			)
			.addText((text) => {
				text
					.setPlaceholder('fill available width')
					.setValue(this.plugin.settings.boardSize?.toString() ?? '')
					.onChange((value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.boardSize = Number.isFinite(parsed) ? parsed : null;
						this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Show comments')
			.setDesc('Show the notes panel underneath the board by default')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.viewComments)
					.onChange((viewComments) => {
						this.plugin.settings.viewComments = viewComments;
						this.plugin.saveSettings();
					});
			});
	}
}
