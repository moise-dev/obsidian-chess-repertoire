import {
	App,
	ColorComponent,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
} from 'obsidian';
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

type SettingKey = keyof ChessRepertoirePluginSettings;

/**
 * The theme's muted text colour, resolved to something the colour picker can
 * show. It only understands hex, and `--text-muted` is usually an rgb() or a
 * var chain, so it is measured off a throwaway element rather than read.
 */
const themeMutedColor = (): string => {
	const probe = document.body.createDiv({ cls: 'chess-repertoire-color-probe' });

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

	/**
	 * The settings, as data. Obsidian renders these itself and indexes them so
	 * the settings search can find them.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Board orientation',
				desc: 'Sets the default orientation of the board',
				control: {
					type: 'dropdown',
					key: 'boardOrientation',
					options: { white: 'White', black: 'Black' },
					defaultValue: DEFAULT_SETTINGS.boardOrientation,
				},
			},
			{
				name: 'Board color',
				desc: 'Sets the default color of the board',
				control: {
					type: 'dropdown',
					key: 'boardColor',
					options: BOARD_COLORS,
					defaultValue: DEFAULT_SETTINGS.boardColor,
				},
			},
			{
				name: 'Board coordinates',
				desc: 'Show the a-h / 1-8 labels on the board',
				control: {
					type: 'toggle',
					key: 'showCoordinates',
					defaultValue: DEFAULT_SETTINGS.showCoordinates,
				},
			},
			{
				name: 'Coordinate color',
				desc:
					"Color of the coordinate labels. Reset to follow the theme's muted text color.",
				aliases: ['coordinates'],
				render: (setting) => this.renderCoordinateColor(setting),
			},
			{
				name: 'Default width',
				desc:
					'Default width of the widget in pixels. Leave empty to fill the width of the note. Individual repertoires can be resized by dragging their bottom-right corner.',
				control: {
					type: 'text',
					key: 'boardSize',
					placeholder: 'fill available width',
				},
			},
			{
				name: 'Show comments',
				desc: 'Show the notes panel underneath the board by default',
				control: {
					type: 'toggle',
					key: 'viewComments',
					defaultValue: DEFAULT_SETTINGS.viewComments,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as SettingKey];

		// The width is stored as a number so the board can use it directly, but
		// its control is a text field that has to be able to say "empty".
		return key === 'boardSize' ? value?.toString() ?? '' : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'boardSize') {
			const parsed = Number.parseInt(String(value), 10);

			this.plugin.settings.boardSize = Number.isFinite(parsed) ? parsed : null;
		} else {
			Object.assign(this.plugin.settings, { [key]: value });
		}

		await this.plugin.saveSettings();
	}

	/**
	 * The colour picker and its reset button. A plain `color` control cannot
	 * carry the extra button, and the picker has no empty state, so it shows
	 * what the labels currently look like: the chosen colour, or the theme's own.
	 */
	private renderCoordinateColor(setting: Setting): void {
		let picker: ColorComponent | null = null;

		setting
			.addColorPicker((component) => {
				picker = component;

				component
					.setValue(this.plugin.settings.coordinateColor || themeMutedColor())
					.onChange((coordinateColor) => {
						this.plugin.settings.coordinateColor = coordinateColor;
						void this.plugin.saveSettings();
					});
			})
			.addExtraButton((button) => {
				button
					.setIcon('rotate-ccw')
					.setTooltip('Follow the theme')
					.onClick(() => {
						// Straight into the picker rather than redrawing the whole
						// tab for one control. Before the setting is cleared, so it
						// still ends up empty if the picker fires its own onChange.
						picker?.setValue(themeMutedColor());

						this.plugin.settings.coordinateColor = '';
						void this.plugin.saveSettings();
					});
			});
	}
}
