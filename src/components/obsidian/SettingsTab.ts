import {
	App,
	ColorComponent,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	debounce,
} from 'obsidian';
import { INITIAL_DATA_VERSION } from 'src/lib/storage/migration';
import ChessRepertoirePlugin from 'src/main';

export const BOARD_COLORS = {
	blue: 'Blue',
	'blue-soft': 'Blue (soft)',
	green: 'Green',
	brown: 'Brown',
} as const;

export type BoardColor = keyof typeof BOARD_COLORS;

/**
 * Where repertoires go when the user has not said otherwise.
 *
 * A folder in the vault rather than in the plugin's own directory: everything
 * under `.obsidian/plugins/<id>/` is deleted when the plugin is uninstalled,
 * and is not covered by "all files and extensions" sync, version history or
 * file recovery. Repertoires are the user's work and belong with their notes.
 */
export const DEFAULT_STORAGE_FOLDER = 'Chess Repertoires';

/**
 * Why a folder cannot be used, or nothing when it can.
 *
 * Obsidian's adapter takes vault-relative paths, so anything absolute or
 * climbing out of the vault would be written somewhere the user cannot see and
 * sync will not carry. Rejected here rather than sanitised: silently rewriting
 * someone's path to a different folder is worse than telling them.
 */
export const validateStorageFolder = (folder: string): string | void => {
	const trimmed = folder.trim();

	if (!trimmed) return;

	if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed))
		return 'Use a folder inside the vault, not a full path.';

	if (trimmed.split(/[\\/]/).includes('..'))
		return 'The folder has to be inside the vault.';
};

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
	/**
	 * Vault-relative folder holding the repertoire and drill files.
	 *
	 * Empty means `DEFAULT_STORAGE_FOLDER`, so a vault that has never opened the
	 * settings - every vault upgrading from 1.2.0 and earlier - lands somewhere
	 * sensible without being asked.
	 */
	storageFolder: string;
	/**
	 * Vault-relative folder searched for the repertoires in use, when clearing
	 * away the files nothing refers to.
	 *
	 * Empty - the default - is the whole vault, which is the only answer that
	 * cannot be wrong. A vault keeping its chess notes in one place can name it
	 * and have the search read that folder alone.
	 */
	notesFolder: string;
	/**
	 * The shape of the data this vault has been migrated to; see
	 * `CURRENT_DATA_VERSION`. Absent - every vault up to 1.2.0 - means
	 * `INITIAL_DATA_VERSION`, and the migrations sort out what that vault
	 * actually has on disk.
	 */
	dataVersion: number;
}

export const DEFAULT_SETTINGS: ChessRepertoirePluginSettings = {
	boardOrientation: 'white',
	boardColor: 'blue',
	viewComments: true,
	boardSize: null,
	showCoordinates: true,
	coordinateColor: '',
	storageFolder: '',
	notesFolder: '',
	dataVersion: INITIAL_DATA_VERSION,
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
				name: 'Repertoire folder',
				desc: `Vault folder holding your repertoires and drill history. Leave empty to use "${DEFAULT_STORAGE_FOLDER}" in the root of the vault. Changing this moves the files already written into the new folder.`,
				aliases: ['storage', 'folder', 'location'],
				control: {
					// A folder suggester rather than a plain text field: the path has
					// to be one the vault actually has, and a typo here would strand
					// every repertoire in a folder nobody meant to make.
					type: 'folder',
					key: 'storageFolder',
					placeholder: DEFAULT_STORAGE_FOLDER,
					validate: (value) => validateStorageFolder(value),
				},
			},
			{
				name: 'Notes folder',
				desc:
					'Which notes to search when looking for unused repertoire files. Leave empty to search the whole vault; naming the folder your boards are in is faster on a large vault. Notes outside it are never read, so a repertoire used only by one of them would be listed as unused.',
				aliases: ['notes', 'search', 'scan'],
				control: {
					type: 'folder',
					key: 'notesFolder',
					placeholder: 'the whole vault',
					validate: (value) => validateStorageFolder(value),
				},
			},
			{
				name: 'Unused repertoire files',
				desc:
					'A repertoire file is written when you make the board and stays behind when the block is deleted. This finds the ones no note refers to and offers to move them to the trash.',
				aliases: ['cleanup', 'unused', 'orphan', 'delete'],
				render: (setting) => this.renderCleanup(setting),
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

	/**
	 * Follows the folder setting once the user has stopped changing it.
	 *
	 * The control reports every keystroke, and acting on each one would create a
	 * folder per prefix typed and drag the repertoires through all of them. The
	 * setting itself is saved immediately; only the part that touches the vault
	 * waits for the value to settle.
	 */
	private readonly applyStorageFolder = debounce(
		() => void this.plugin.applyStorageFolder(),
		1000,
		true
	);

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === 'storageFolder') {
			// Trimmed so a stray space does not become a folder named ' '.
			this.plugin.settings.storageFolder = String(value).trim();

			await this.plugin.saveSettings();

			this.applyStorageFolder();

			return;
		}

		if (key === 'notesFolder') {
			this.plugin.settings.notesFolder = String(value).trim();

			await this.plugin.saveSettings();

			return;
		}

		if (key === 'boardSize') {
			const parsed = Number.parseInt(String(value), 10);

			this.plugin.settings.boardSize = Number.isFinite(parsed) ? parsed : null;
		} else {
			Object.assign(this.plugin.settings, { [key]: value });
		}

		await this.plugin.saveSettings();
	}

	/**
	 * The button that goes looking for unused repertoire files.
	 *
	 * Here rather than in the command palette because it belongs with the two
	 * settings that decide what it does - which folder the files are in, and
	 * which folder is searched for the ones still in use.
	 */
	private renderCleanup(setting: Setting): void {
		setting.addButton((button) => {
			const label = 'Find unused files';

			button.setButtonText(label).onClick(() => {
				// The scan reads every note in the folder, which on a large vault is
				// long enough to click twice.
				button.setDisabled(true).setButtonText('Looking...');

				void this.plugin.cleanUpUnusedRepertoires().finally(() => {
					button.setDisabled(false).setButtonText(label);
				});
			});
		});
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
