import { normalizePath } from 'obsidian';

/**
 * The shape of the data on disk, as a number the vault records in its settings.
 *
 * Migrations are driven off this and never off what happens to be in a folder.
 * Sniffing for files answers "does this look unmigrated" - which stops being
 * true the moment a folder gains a file it did not have when the check was
 * written. A recorded version answers "what has this vault already been
 * through", which stays true whatever ends up on disk later.
 *
 * Bump it when a step is added to `MIGRATIONS`, and nowhere else.
 */
export const CURRENT_DATA_VERSION = 1;

/**
 * A vault that has never recorded a version.
 *
 * Every install up to 1.2.0, whether or not it has any repertoires: there is no
 * way to tell the two apart from settings alone, so both are walked through the
 * steps and the steps are written to do nothing when there is nothing to do.
 */
export const INITIAL_DATA_VERSION = 0;

/**
 * The slice of Obsidian's `DataAdapter` the migrations use.
 *
 * Declared structurally rather than imported so the steps can be run against a
 * fake in the tests; `DataAdapter` satisfies it.
 */
export interface StorageFileAdapter {
	list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
	read(normalizedPath: string): Promise<string>;
	write(normalizedPath: string, data: string, options?: unknown): Promise<void>;
	remove(normalizedPath: string): Promise<void>;
	exists(normalizedPath: string): Promise<boolean>;
	rename(normalizedPath: string, normalizedNewPath: string): Promise<void>;
}

/**
 * Where repertoires lived up to 1.2.0: inside the plugin's own folder, which
 * Obsidian deletes wholesale when the plugin is uninstalled, and which sync,
 * version history and file recovery all pass over.
 */
export const legacyStoragePath = (
	configDir: string,
	pluginId: string
): string => normalizePath(`${configDir}/plugins/${pluginId}/storage`);

/**
 * Where the legacy folder is parked once its contents have been copied out.
 *
 * Still inside the plugin folder, so it goes the same way on uninstall - it is
 * a safety net for the days right after the move, not the durable copy. What it
 * buys is that the originals survive under a name the migration will not read
 * again, so a second run cannot copy them back or trip over them.
 */
export const legacyBackupPath = (configDir: string, pluginId: string): string =>
	normalizePath(`${configDir}/plugins/${pluginId}/storage_bak`);

/** A repertoire (`<id>.json`) or its drill history (`<id>.drill.json`). */
const isStorageFile = (name: string | undefined): name is string =>
	Boolean(name?.endsWith('.json'));

/** What one pass over a folder of repertoires did. */
export interface StorageTransferResult {
	transferred: number;
	/** A file of that name was already at the destination, so it was left alone. */
	skipped: number;
	failed: number;
}

const emptyTransfer = (): StorageTransferResult => ({
	transferred: 0,
	skipped: 0,
	failed: 0,
});

/**
 * Copies every repertoire and drill file from one folder into another, and
 * optionally deletes the original once its copy is safely written.
 *
 * Never overwrites: a name already taken at the destination is counted as
 * skipped and both copies are left as they are. Losing a repertoire to a
 * migration would be worse than the problem the migration is solving, so the
 * destination always wins.
 *
 * Copy first and delete after, one file at a time, so an interrupted run leaves
 * a file in both places rather than in neither. A file that could not be copied
 * is never deleted.
 */
const transferStorageFiles = async (
	adapter: StorageFileAdapter,
	from: string,
	to: string,
	{ removeOriginal }: { removeOriginal: boolean }
): Promise<StorageTransferResult> => {
	const result = emptyTransfer();

	const source = normalizePath(from);
	const destination = normalizePath(to);

	if (source === destination) return result;

	if (!(await adapter.exists(source))) return result;

	const { files } = await adapter.list(source);

	for (const file of files) {
		const name = file.split('/').pop();

		if (!isStorageFile(name)) continue;

		const target = normalizePath(`${destination}/${name}`);

		try {
			if (await adapter.exists(target)) {
				result.skipped += 1;

				continue;
			}

			await adapter.write(target, await adapter.read(file), {});

			if (removeOriginal) await adapter.remove(file);

			result.transferred += 1;
		} catch (e) {
			console.error(`chess-repertoire: could not move ${name}`, e);

			result.failed += 1;
		}
	}

	return result;
};

/** Copies the repertoires out of `from`, leaving the originals in place. */
export const copyStorageFiles = (
	adapter: StorageFileAdapter,
	from: string,
	to: string
): Promise<StorageTransferResult> =>
	transferStorageFiles(adapter, from, to, { removeOriginal: false });

/**
 * Moves the repertoires out of `from`, for a user who changes where their
 * repertoires live. Anything that could not be moved stays readable in the old
 * folder.
 */
export const moveStorageFiles = (
	adapter: StorageFileAdapter,
	from: string,
	to: string
): Promise<StorageTransferResult> =>
	transferStorageFiles(adapter, from, to, { removeOriginal: true });

/**
 * Renames a folder out of the way, returning where it ended up or `null` if
 * nowhere was free.
 *
 * `preferred` is used when it is available, and a numbered sibling otherwise,
 * so a migration that had to be retried never writes over the backup an earlier
 * attempt left behind. Gives up after a handful of tries rather than looping: at
 * that point something is wrong that another name will not fix.
 */
export const archiveFolder = async (
	adapter: StorageFileAdapter,
	path: string,
	preferred: string
): Promise<string | null> => {
	for (let attempt = 0; attempt < 20; attempt++) {
		const target = normalizePath(
			attempt ? `${preferred}_${attempt + 1}` : preferred
		);

		if (await adapter.exists(target)) continue;

		await adapter.rename(normalizePath(path), target);

		return target;
	}

	return null;
};

/** What a migration step needs to know about the vault it is running in. */
export interface MigrationContext {
	adapter: StorageFileAdapter;
	/** `app.vault.configDir`, normally `.obsidian`. */
	configDir: string;
	pluginId: string;
	/** The folder repertoires are read from and written to now. */
	storagePath: string;
}

export interface MigrationStepResult {
	/**
	 * Whether the step is finished. A step that reports `false` leaves the
	 * recorded version where it was, so the next load tries again rather than
	 * marking the vault migrated with files left behind.
	 */
	done: boolean;
	/** Shown to the user, when there is something worth telling them. */
	notice?: string;
}

export interface MigrationStep {
	/** The version the vault is at once this step has run. */
	version: number;
	/** For the console, when a step fails. */
	name: string;
	run(context: MigrationContext): Promise<MigrationStepResult>;
}

const plural = (count: number, one: string, many: string): string =>
	`${count} ${count === 1 ? one : many}`;

/**
 * Brings repertoires written by 1.2.0 and earlier into the vault.
 *
 * Those files sit inside the plugin's own folder, which Obsidian deletes when
 * the plugin is uninstalled - so a user who reinstalls to fix something loses
 * every repertoire, with no copy in sync, version history or file recovery to
 * go back to.
 *
 * Copies them into the configured folder, then renames the old folder to
 * `storage_bak` rather than deleting it. The rename is what makes the step
 * idempotent: there is no longer anything at the legacy path, so a rerun sees
 * an already-migrated vault whatever the recorded version says.
 */
const moveStorageOutOfPluginFolder: MigrationStep = {
	version: 1,
	name: 'move storage out of the plugin folder',
	async run({ adapter, configDir, pluginId, storagePath }) {
		const legacy = legacyStoragePath(configDir, pluginId);

		// A vault installing the plugin for the first time, or one already moved.
		if (!(await adapter.exists(legacy))) return { done: true };

		const { transferred, skipped, failed } = await copyStorageFiles(
			adapter,
			legacy,
			storagePath
		);

		if (failed)
			return {
				done: false,
				notice: `Chess Repertoire could not move ${plural(
					failed,
					'file',
					'files'
				)} out of the plugin folder. Nothing was deleted, and this will be tried again next time the plugin loads.`,
			};

		const archived = await archiveFolder(
			adapter,
			legacy,
			legacyBackupPath(configDir, pluginId)
		);

		// The copies are in the vault either way, so the step is done; the old
		// folder just could not be renamed, and saying so is the whole fix.
		if (!archived)
			return {
				done: true,
				notice: `Chess Repertoire copied your repertoires into "${storagePath}", but could not rename the old plugin folder. You can delete "${legacy}" by hand once you have checked them.`,
			};

		if (!transferred && !skipped) return { done: true };

		const moved = transferred
			? `Chess Repertoire moved ${plural(
					transferred,
					'file',
					'files'
			  )} into "${storagePath}", where your sync and file recovery can see ${
					transferred === 1 ? 'it' : 'them'
			  }.`
			: `Chess Repertoire found ${plural(
					skipped,
					'file',
					'files'
			  )} already in "${storagePath}".`;

		const left =
			transferred && skipped
				? ` ${plural(skipped, 'file was', 'files were')} already there and ${
						skipped === 1 ? 'was' : 'were'
				  } left alone.`
				: '';

		return {
			done: true,
			notice: `${moved}${left} The originals are still in "${archived}", which is deleted when the plugin is uninstalled - so copy anything you want to keep out of it. You can change the folder in the plugin settings.`,
		};
	},
};

/**
 * Every step, in the order they run. Append only, and never renumber: the
 * version a vault has recorded is a claim about which of these have run.
 */
export const MIGRATIONS: MigrationStep[] = [moveStorageOutOfPluginFolder];

export interface MigrationRunResult {
	/** The version to record. Only advances past steps that finished. */
	version: number;
	/** In the order they were produced. */
	notices: string[];
}

/**
 * Runs every step the vault has not been through yet.
 *
 * Stops at the first step that does not finish, so a later step never runs
 * against a half-migrated vault and the recorded version never claims more than
 * actually happened. A step that throws is treated the same way as one that
 * reports itself unfinished: it will be tried again next load.
 */
export const runMigrations = async (
	from: number,
	context: MigrationContext
): Promise<MigrationRunResult> => {
	const result: MigrationRunResult = { version: from, notices: [] };

	for (const step of MIGRATIONS) {
		if (step.version <= from) continue;

		try {
			const { done, notice } = await step.run(context);

			if (notice) result.notices.push(notice);

			if (!done) break;

			result.version = step.version;
		} catch (e) {
			console.error(`chess-repertoire: migration "${step.name}" failed`, e);

			break;
		}
	}

	return result;
};
