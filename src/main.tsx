import { Chess } from 'chess.js';
import { Editor, Notice, Plugin, normalizePath } from 'obsidian';
import {
	CURRENT_DRILL_VERSION,
	CURRENT_STORAGE_VERSION,
	ChessRepertoireDataAdapter,
	ChessRepertoireFileData,
} from 'src/lib/storage';
import {
	CURRENT_DATA_VERSION,
	moveStorageFiles,
	runMigrations,
} from 'src/lib/storage/migration';
import { PositionView } from './components/PositionView';
import { ReactView } from './components/ReactView';
import { ChessStringModal } from './components/obsidian/ChessStringModal';
import { ConfirmModal } from './components/obsidian/ConfirmModal';
import {
	ChessRepertoirePluginSettings,
	DEFAULT_SETTINGS,
	DEFAULT_STORAGE_FOLDER,
	SettingsTab,
} from './components/obsidian/SettingsTab';

// these styles must be imported somewhere
import 'assets/board/themes.css';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import { nanoid } from 'nanoid';
import { findCodeBlocks } from './lib/blocks';
import {
	UnusedRepertoire,
	UnusedScan,
	findUnusedRepertoires,
	isInSearchFolder,
	isSearchableNote,
	unusedFileCount,
	unusedFileLines,
} from './lib/cleanup';
import { handleRepertoireKey, releaseOnOutsideClick } from './lib/keyboard';
import { chessRepertoireKeymap } from './lib/keyboard/extension';
import { mergeDrillStats, mergeRepertoires } from './lib/merge';
import { parseUserConfig } from './lib/obsidian';
import { looksLikeFen, parsePgn, titleFromHeaders } from './lib/pgn';
import { parsePositionConfig } from './lib/position';
import './main.css';

/** Either a position (FEN) or a game (PGN); `looksLikeFen` tells them apart. */
export type ChessString = string;

export const ROOT_FEN =
	'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// TODO:
// 1) Allow to show the root position
// 2) Display correct move after removing the last move

/** What a merge did, in one line. */
const mergeNotice = (merged: number, skipped: number): string =>
	[
		`Merged ${merged} repertoires into a new one.`,
		skipped &&
			`${skipped} ${
				skipped === 1 ? 'repertoire starts' : 'repertoires start'
			} from another position and ${skipped === 1 ? 'was' : 'were'} left out.`,
	]
		.filter(Boolean)
		.join(' ');

/** `2 files`, `1 file`. */
const plural = (count: number, one: string, many: string): string =>
	`${count} ${count === 1 ? one : many}`;

export default class ChessRepertoirePlugin extends Plugin {
	settings: ChessRepertoirePluginSettings;
	dataAdapter: ChessRepertoireDataAdapter;

	/**
	 * The folder repertoires are read from and written to.
	 *
	 * A getter rather than a field: the folder is a setting now, and the value is
	 * wanted again every time it changes. Empty falls back to the default, which
	 * is what every vault upgrading from 1.2.0 or earlier will have.
	 */
	get storagePath(): string {
		return normalizePath(
			this.settings.storageFolder.trim() || DEFAULT_STORAGE_FOLDER
		);
	}

	/**
	 * Where the repertoires actually are, as opposed to where the setting now
	 * says they should be.
	 *
	 * The two come apart while the setting is being edited, and the move has to
	 * start from the folder holding the files rather than from whatever the
	 * setting said a moment ago - otherwise a run of edits leaves them behind in
	 * the first folder and moves nothing out of the ones in between.
	 */
	private settledStoragePath: string;

	async onload() {
		// Load Settings
		await this.loadSettings();

		// Register Data Adapter
		this.dataAdapter = new ChessRepertoireDataAdapter(
			this.app.vault.adapter,
			this.storagePath
		);

		this.settledStoragePath = this.storagePath;

		await this.dataAdapter.createStorageFolderIfNotExists();

		await this.runMigrations();

		// Add settings tab
		this.addSettingTab(new SettingsTab(this.app, this));

		// Add command
		this.addCommand({
			// Obsidian namespaces this as `chess-repertoire:insert-editor`, so the
			// id says only what the command does. It used to carry the plugin's
			// name as well, which the plugin review flags and which read twice over
			// in the palette. Renaming an id drops any hotkey set against the old
			// one, so this can only be done before the plugin is in the store, and
			// never again afterwards.
			id: 'insert-editor',
			name: 'Insert FEN/PGN editor at cursor position',
			editorCallback: (editor: Editor) => {
				const cursorPosition = editor.getCursor();

				const onSubmit = async (chessString: ChessString | undefined) => {
					try {
						const chessStringTrimmed = chessString?.trim() ?? '';

						const isFen = looksLikeFen(chessStringTrimmed);

						// Validates it, and throws for the notice below if it is not a
						// position after all.
						if (isFen) new Chess(chessStringTrimmed);

						const parsed = isFen
							? null
							: parsePgn(chessStringTrimmed, ROOT_FEN, nanoid);

						if (parsed?.skipped) {
							new Notice(
								`${parsed.skipped} ${
									parsed.skipped === 1 ? 'move' : 'moves'
								} in that PGN could not be read and were left out.`
							);
						}

						const chessRepertoireFileData: ChessRepertoireFileData = {
							version: CURRENT_STORAGE_VERSION,
							header: {
								title: parsed ? titleFromHeaders(parsed.headers) : null,
							},
							moves: parsed?.moves ?? [],
							rootVariants: parsed?.rootVariants ?? [],
							rootFEN: isFen ? chessStringTrimmed : parsed?.rootFEN ?? ROOT_FEN,
						};

						await this.dataAdapter.createStorageFolderIfNotExists();

						const id = await this.dataAdapter.saveFile(chessRepertoireFileData);

						editor.replaceRange(
							`\`\`\`chessRepertoire\nchessRepertoireId: ${id}\n\`\`\``,
							cursorPosition
						);
					} catch (e) {
						console.error('chess-repertoire: could not parse the input', e);
						new Notice('There was an error during PGN parsing.', 0);
					}
				};

				new ChessStringModal(
					this.app,
					(chessString) => void onSubmit(chessString)
				).open();
			},
		});

		// Combine every repertoire in a note into one
		this.addCommand({
			// Renamed with the id above, and on the same terms.
			id: 'merge-repertoires',
			name: 'Merge every repertoire in this note into one',
			editorCallback: async (editor: Editor) => {
				const cursorPosition = editor.getCursor();
				const ids = this.repertoireIdsIn(editor.getValue());

				if (ids.length < 2) {
					new Notice(
						'This note needs at least two chess repertoires before there is anything to merge.'
					);

					return;
				}

				try {
					const repertoires = await Promise.all(
						ids.map((id) => this.dataAdapter.loadFile(id))
					);

					const { repertoire, skipped } = mergeRepertoires(
						repertoires,
						CURRENT_STORAGE_VERSION
					);

					const mergedId = await this.dataAdapter.saveFile(repertoire);

					// The merged repertoire keeps every move id, so the drills already done
					// against the originals still name real moves.
					const stats = mergeDrillStats(
						await Promise.all(ids.map((id) => this.dataAdapter.loadDrillData(id)))
					);

					if (Object.keys(stats).length)
						await this.dataAdapter.saveDrillData(mergedId, {
							version: CURRENT_DRILL_VERSION,
							stats,
						});

					// At the cursor, leaving the repertoires it was built from alone: a
					// merge is not a decision to throw the originals away.
					editor.replaceRange(
						`\`\`\`chessRepertoire\nchessRepertoireId: ${mergedId}\n\`\`\``,
						cursorPosition
					);

					new Notice(mergeNotice(ids.length - skipped, skipped));
				} catch (e) {
					console.error(
						'chess-repertoire: could not merge the repertoires in this note',
						e
					);
					new Notice(
						'There was an error while merging the repertoires in this note.',
						0
					);
				}
			},
		});

		this.registerRepertoireKeyboard();

		this.registerPositionBlock();

		// Add chess repertoire code block processor
		this.registerMarkdownCodeBlockProcessor(
			'chessRepertoire',
			async (source, el, ctx) => {
				const { chessRepertoireId } = parseUserConfig(this.settings, source);

				if (!chessRepertoireId.trim().length)
					return new Notice(
						"No chessRepertoireId parameter found, please add one manually if the file already exists or add it via the 'Insert FEN/PGN editor at cursor position' command.",
						0
					);

				try {
					const data = await this.dataAdapter.loadFile(chessRepertoireId);

					ctx.addChild(
						new ReactView(
							el,
							source,
							this.app,
							ctx,
							this.settings,
							data,
							this.dataAdapter
						)
					);
				} catch {
					new Notice(
						`There was an error while trying to load ${chessRepertoireId}.json. You can check the plugin folder if the file exist and if not add one via the 'Insert FEN/PGN editor at cursor position' command.`,
						0
					);
				}
			}
		);
	}

	/**
	 * Offers to trash every file in the storage folder that no note refers to.
	 *
	 * A repertoire's file is written the moment the board is made, before its
	 * block reaches the note, and nothing takes it away again: a board thought
	 * better of, a note deleted, or a merge kept for its result all leave one
	 * behind, under a name that says nothing about what is in it. The folder
	 * cannot answer which those are - only the notes can, so they are read.
	 *
	 * Driven from the settings tab, next to the two folders that decide what it
	 * looks at and what it reads.
	 */
	async cleanUpUnusedRepertoires() {
		const storageFolder = this.dataAdapter.storagePath;
		const searchFolder = this.settings.notesFolder.trim();

		// Read lazily, and only up to the point where every repertoire has been
		// accounted for: a vault whose repertoires are all in use never gets past
		// the notes holding them.
		const notes = this.app.vault
			.getFiles()
			.filter(
				(file) =>
					isSearchableNote(file.extension) &&
					isInSearchFolder(file.path, searchFolder)
			)
			.map((file) => ({
				path: file.path,
				read: () => this.app.vault.cachedRead(file),
			}));

		// A folder with nothing in it to read would call every repertoire unused,
		// and the folder being wrong is a likelier explanation than the vault
		// having abandoned all of them. Only when one was named: a vault with no
		// notes at all really has nothing using its repertoires.
		if (searchFolder && !notes.length) {
			new Notice(
				`Chess Repertoire found no notes in "${searchFolder}", so nothing was checked. Change the notes folder in the settings, or leave it empty to search the whole vault.`,
				0
			);

			return;
		}

		let scan: UnusedScan;

		try {
			scan = await findUnusedRepertoires(
				this.app.vault.adapter,
				storageFolder,
				notes
			);
		} catch (e) {
			// A note that could not be read is a note that might have been the one
			// naming a repertoire, so the whole run is abandoned rather than acted
			// on: the answer this gives is only as good as its reading of the notes.
			console.error(
				'chess-repertoire: could not read the notes while looking for unused repertoires',
				e
			);

			new Notice(
				'Chess Repertoire could not read every note it needed to, so nothing was deleted.',
				0
			);

			return;
		}

		const searched = searchFolder ? `"${searchFolder}"` : 'your vault';

		const left = scan.skipped
			? ` ${plural(scan.skipped, 'other file', 'other files')} in the folder ${
					scan.skipped === 1 ? 'is' : 'are'
			  } not something the plugin wrote, and will be left alone.`
			: '';

		if (!scan.unused.length) {
			new Notice(
				`Every repertoire in "${storageFolder}" is used by a note in ${searched}.${left}`,
				scan.skipped ? 0 : undefined
			);

			return;
		}

		const files = unusedFileCount(scan.unused);

		new ConfirmModal(this.app, {
			title: 'Delete unused repertoire files?',
			body: `You are about to delete ${plural(
				files,
				'unused file',
				'unused files'
			)} from "${storageFolder}". No note in ${searched} refers to ${
				scan.unused.length === 1 ? 'it' : 'them'
			}, and ${files === 1 ? 'it goes' : 'they go'} to the trash.${left}`,
			details: {
				summary: `Show the ${plural(files, 'file', 'files')}`,
				items: unusedFileLines(scan.unused),
			},
			confirmText: 'Move to trash',
			onConfirm: () => void this.trashUnusedRepertoires(scan.unused),
		}).open();
	}

	/** Trashes what the user has just agreed to, and reports what actually went. */
	private async trashUnusedRepertoires(unused: UnusedRepertoire[]) {
		let trashed = 0;
		let failed = 0;

		for (const { paths } of unused)
			for (const path of paths) {
				try {
					await this.dataAdapter.trashFile(path);

					trashed += 1;
				} catch (e) {
					console.error(`chess-repertoire: could not delete ${path}`, e);

					failed += 1;
				}
			}

		new Notice(
			[
				`Chess Repertoire moved ${plural(trashed, 'file', 'files')} to the trash.`,
				failed &&
					`${plural(failed, 'file', 'files')} could not be deleted and ${
						failed === 1 ? 'is' : 'are'
					} still in the folder.`,
			]
				.filter(Boolean)
				.join(' '),
			failed ? 0 : undefined
		);
	}

	/**
	 * Routes the widget's shortcuts around CodeMirror.
	 *
	 * Two ways in, because neither covers everything on its own. The editor
	 * extension is the one that matters in Live Preview, where it runs ahead of
	 * the Vim keymap; the window listener catches Reading view and anywhere the
	 * extension does not reach. Whichever arrives first stops the other, so a
	 * key is never acted on twice.
	 */
	private registerRepertoireKeyboard() {
		this.registerEditorExtension(chessRepertoireKeymap());

		this.registerDomEvent(
			window,
			'keydown',
			(event) => handleRepertoireKey(event),
			{ capture: true }
		);

		this.registerDomEvent(document, 'pointerdown', releaseOnOutsideClick, {
			capture: true,
		});
	}

	/**
	 * A bare position, for anywhere a board is wanted without a repertoire behind it
	 * - the cards of an exported map, most of all, which would otherwise be
	 * lines of notation with nothing to look at.
	 */
	private registerPositionBlock() {
		this.registerMarkdownCodeBlockProcessor(
			'chessPosition',
			(source, el, ctx) => {
				const config = parsePositionConfig(this.settings, source);

				if (!config) {
					el.createEl('p', {
						text: 'This chessPosition block has no readable FEN.',
						cls: 'cs-empty-state',
					});

					return;
				}

				ctx.addChild(new PositionView(el, this.app, this.settings, config));
			}
		);
	}

	/**
	 * The repertoire ids of every chessRepertoire block in a note, in the order they
	 * appear. A block whose settings will not parse is left out rather than
	 * taken as an error: it would not render either.
	 */
	private repertoireIdsIn(content: string): string[] {
		return findCodeBlocks(content, 'chessRepertoire')
			.map((body) => {
				try {
					return (
						parseUserConfig(this.settings, body).chessRepertoireId?.trim() ?? ''
					);
				} catch {
					return '';
				}
			})
			.filter(Boolean);
	}

	/**
	 * Points the adapter at the configured folder, makes sure it is there, and
	 * brings the repertoires along from wherever they currently are.
	 *
	 * Called whenever the setting settles on a new value. Does nothing when the
	 * folder has not actually moved, so calling it twice is free.
	 */
	async applyStorageFolder() {
		const previous = this.settledStoragePath;

		this.dataAdapter.setStoragePath(this.storagePath);

		await this.dataAdapter.createStorageFolderIfNotExists();

		if (previous === this.storagePath) return;

		// Recorded before the move rather than after: a move that throws half way
		// has already left files in the new folder, and the next change should
		// start from there rather than trying the old folder again.
		this.settledStoragePath = this.storagePath;

		try {
			const { transferred, skipped, failed } = await moveStorageFiles(
				this.app.vault.adapter,
				previous,
				this.storagePath
			);

			if (transferred)
				new Notice(
					`Chess Repertoire moved ${transferred} ${
						transferred === 1 ? 'file' : 'files'
					} into "${this.storagePath}".`
				);

			if (skipped)
				new Notice(
					`Chess Repertoire left ${skipped} ${
						skipped === 1 ? 'file' : 'files'
					} in "${previous}": something of the same name was already in "${
						this.storagePath
					}".`,
					0
				);

			if (failed)
				new Notice(
					`Chess Repertoire could not move ${failed} ${
						failed === 1 ? 'file' : 'files'
					} out of "${previous}". ${
						failed === 1 ? 'It is' : 'They are'
					} still there and can be moved by hand.`,
					0
				);
		} catch (e) {
			// The new folder is already in effect, so the worst case is repertoires
			// left in the old one - recoverable by hand, and not worth failing the
			// setting change over.
			console.error(
				'chess-repertoire: could not move the repertoires to the new folder',
				e
			);

			new Notice(
				`Chess Repertoire could not move your repertoires out of "${previous}". They are still there.`,
				0
			);
		}
	}

	/**
	 * Walks the vault through whatever migrations it has not been through, and
	 * records how far it got.
	 *
	 * Never fatal: a migration that throws must not stop the plugin loading, or a
	 * vault it cannot migrate becomes a vault it cannot open either.
	 */
	private async runMigrations() {
		if (this.settings.dataVersion >= CURRENT_DATA_VERSION) return;

		try {
			const { version, notices } = await runMigrations(this.settings.dataVersion, {
				adapter: this.app.vault.adapter,
				configDir: this.app.vault.configDir,
				pluginId: this.manifest.id,
				storagePath: this.storagePath,
			});

			if (version !== this.settings.dataVersion) {
				this.settings.dataVersion = version;

				await this.saveSettings();
			}

			// Persistent: these say where a user's repertoires went, which is not
			// something to catch out of the corner of an eye.
			for (const notice of notices) new Notice(notice, 0);
		} catch (e) {
			console.error('chess-repertoire: could not migrate the vault', e);
		}
	}

	async loadSettings() {
		const saved = (await this.loadData()) as
			| Partial<ChessRepertoirePluginSettings>
			| null
			| undefined;

		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
