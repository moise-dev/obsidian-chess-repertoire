import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	CURRENT_DATA_VERSION,
	INITIAL_DATA_VERSION,
	MIGRATIONS,
	MigrationContext,
	StorageFileAdapter,
	archiveFolder,
	copyStorageFiles,
	legacyBackupPath,
	legacyStoragePath,
	moveStorageFiles,
	runMigrations,
} from '../src/lib/storage/migration';

const CONFIG_DIR = '.obsidian';
const PLUGIN_ID = 'chess-repertoire';

const LEGACY = legacyStoragePath(CONFIG_DIR, PLUGIN_ID);
const BACKUP = legacyBackupPath(CONFIG_DIR, PLUGIN_ID);
const STORAGE = 'Chess Repertoires';

/**
 * An in-memory stand-in for Obsidian's `DataAdapter`.
 *
 * Folders are implied by the files under them, which is close enough to the
 * real thing for a migration: the only folder it creates is the destination,
 * and that is the plugin's job rather than the migration's. `unreadable` makes
 * a named file throw on read, for the half-failed runs.
 */
class FakeAdapter implements StorageFileAdapter {
	files = new Map<string, string>();
	unreadable = new Set<string>();
	/** Every rename that was asked for, in order. */
	renames: [string, string][] = [];

	constructor(files: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(files))
			this.files.set(path, content);
	}

	private isFolder(path: string): boolean {
		const prefix = `${path}/`;

		for (const existing of this.files.keys())
			if (existing.startsWith(prefix)) return true;

		return false;
	}

	// Plain promises rather than `async`: none of them await anything, and the
	// lint rule that catches a pointless `async` is right about that.
	exists(path: string): Promise<boolean> {
		return Promise.resolve(this.files.has(path) || this.isFolder(path));
	}

	list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const prefix = `${path}/`;

		const files = [...this.files.keys()].filter(
			(existing) =>
				existing.startsWith(prefix) && !existing.slice(prefix.length).includes('/')
		);

		return Promise.resolve({ files, folders: [] });
	}

	read(path: string): Promise<string> {
		if (this.unreadable.has(path))
			return Promise.reject(new Error(`unreadable: ${path}`));

		const content = this.files.get(path);

		if (content === undefined)
			return Promise.reject(new Error(`missing: ${path}`));

		return Promise.resolve(content);
	}

	write(path: string, data: string): Promise<void> {
		this.files.set(path, data);

		return Promise.resolve();
	}

	remove(path: string): Promise<void> {
		this.files.delete(path);

		return Promise.resolve();
	}

	rename(from: string, to: string): Promise<void> {
		this.renames.push([from, to]);

		for (const [path, content] of [...this.files]) {
			if (path !== from && !path.startsWith(`${from}/`)) continue;

			this.files.delete(path);
			this.files.set(`${to}${path.slice(from.length)}`, content);
		}

		return Promise.resolve();
	}

	/** Paths under a folder, sorted, for asserting on the shape of the result. */
	under(path: string): string[] {
		const prefix = `${path}/`;

		return [...this.files.keys()]
			.filter((existing) => existing.startsWith(prefix))
			.sort();
	}
}

const context = (
	adapter: StorageFileAdapter,
	storagePath = STORAGE
): MigrationContext => ({
	adapter,
	configDir: CONFIG_DIR,
	pluginId: PLUGIN_ID,
	storagePath,
});

/** A legacy folder holding one repertoire and its drill history. */
const legacyVault = () =>
	new FakeAdapter({
		[`${LEGACY}/abc.json`]: '{"repertoire":"abc"}',
		[`${LEGACY}/abc.drill.json`]: '{"drill":"abc"}',
	});

describe('copyStorageFiles', () => {
	it('copies the repertoires and leaves the originals alone', async () => {
		const adapter = legacyVault();

		const result = await copyStorageFiles(adapter, LEGACY, STORAGE);

		assert.deepEqual(result, { transferred: 2, skipped: 0, failed: 0 });

		assert.deepEqual(adapter.under(STORAGE), [
			`${STORAGE}/abc.drill.json`,
			`${STORAGE}/abc.json`,
		]);

		assert.equal(
			adapter.files.get(`${STORAGE}/abc.json`),
			'{"repertoire":"abc"}'
		);

		assert.equal(adapter.under(LEGACY).length, 2);
	});

	it('leaves anything that is not a repertoire where it is', async () => {
		const adapter = new FakeAdapter({
			[`${LEGACY}/abc.json`]: '{}',
			[`${LEGACY}/notes.md`]: '# not ours',
			[`${LEGACY}/.DS_Store`]: '',
		});

		const result = await copyStorageFiles(adapter, LEGACY, STORAGE);

		assert.equal(result.transferred, 1);
		assert.deepEqual(adapter.under(STORAGE), [`${STORAGE}/abc.json`]);
	});

	it('never overwrites a file already at the destination', async () => {
		const adapter = legacyVault();

		adapter.files.set(`${STORAGE}/abc.json`, '{"repertoire":"newer"}');

		const result = await copyStorageFiles(adapter, LEGACY, STORAGE);

		assert.deepEqual(result, { transferred: 1, skipped: 1, failed: 0 });

		assert.equal(
			adapter.files.get(`${STORAGE}/abc.json`),
			'{"repertoire":"newer"}'
		);
	});

	it('counts a file it cannot read as failed and carries on', async () => {
		const adapter = legacyVault();

		adapter.unreadable.add(`${LEGACY}/abc.json`);

		const result = await copyStorageFiles(adapter, LEGACY, STORAGE);

		assert.deepEqual(result, { transferred: 1, skipped: 0, failed: 1 });

		assert.deepEqual(adapter.under(STORAGE), [`${STORAGE}/abc.drill.json`]);
	});

	it('does nothing when the source is the destination', async () => {
		const adapter = legacyVault();

		const result = await copyStorageFiles(adapter, LEGACY, `${LEGACY}/`);

		assert.deepEqual(result, { transferred: 0, skipped: 0, failed: 0 });
	});

	it('does nothing when the source is not there', async () => {
		const adapter = new FakeAdapter();

		const result = await copyStorageFiles(adapter, LEGACY, STORAGE);

		assert.deepEqual(result, { transferred: 0, skipped: 0, failed: 0 });
	});
});

describe('moveStorageFiles', () => {
	it('deletes each original once its copy is written', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: '{}',
			[`${STORAGE}/abc.drill.json`]: '{}',
		});

		const result = await moveStorageFiles(adapter, STORAGE, 'Chess/Openings');

		assert.deepEqual(result, { transferred: 2, skipped: 0, failed: 0 });

		assert.deepEqual(adapter.under(STORAGE), []);
		assert.deepEqual(adapter.under('Chess/Openings'), [
			'Chess/Openings/abc.drill.json',
			'Chess/Openings/abc.json',
		]);
	});

	it('keeps the original of anything it could not move', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: '{}',
			[`${STORAGE}/def.json`]: '{}',
			['Chess/def.json']: '{"already":"there"}',
		});

		adapter.unreadable.add(`${STORAGE}/abc.json`);

		const result = await moveStorageFiles(adapter, STORAGE, 'Chess');

		assert.deepEqual(result, { transferred: 0, skipped: 1, failed: 1 });

		// Both are still readable from the old folder.
		assert.deepEqual(adapter.under(STORAGE), [
			`${STORAGE}/abc.json`,
			`${STORAGE}/def.json`,
		]);

		assert.equal(adapter.files.get('Chess/def.json'), '{"already":"there"}');
	});
});

describe('archiveFolder', () => {
	it('renames to the preferred name when it is free', async () => {
		const adapter = legacyVault();

		const archived = await archiveFolder(adapter, LEGACY, BACKUP);

		assert.equal(archived, BACKUP);
		assert.deepEqual(adapter.under(LEGACY), []);
		assert.deepEqual(adapter.under(BACKUP), [
			`${BACKUP}/abc.drill.json`,
			`${BACKUP}/abc.json`,
		]);
	});

	it('numbers a sibling rather than writing over an earlier backup', async () => {
		const adapter = legacyVault();

		adapter.files.set(`${BACKUP}/old.json`, '{"from":"an earlier attempt"}');

		const archived = await archiveFolder(adapter, LEGACY, BACKUP);

		assert.equal(archived, `${BACKUP}_2`);

		assert.equal(
			adapter.files.get(`${BACKUP}/old.json`),
			'{"from":"an earlier attempt"}'
		);
	});

	it('gives up rather than looping when every name is taken', async () => {
		const adapter = legacyVault();

		adapter.files.set(`${BACKUP}/x.json`, '{}');

		for (let n = 2; n <= 20; n++)
			adapter.files.set(`${BACKUP}_${n}/x.json`, '{}');

		const archived = await archiveFolder(adapter, LEGACY, BACKUP);

		assert.equal(archived, null);
		assert.equal(adapter.renames.length, 0);
		assert.equal(adapter.under(LEGACY).length, 2);
	});
});

describe('runMigrations', () => {
	it('records the version for a vault with nothing to migrate', async () => {
		const adapter = new FakeAdapter();

		const result = await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		assert.equal(result.version, CURRENT_DATA_VERSION);
		assert.deepEqual(result.notices, []);
	});

	it('copies the repertoires into the vault and parks the old folder', async () => {
		const adapter = legacyVault();

		const result = await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		assert.equal(result.version, CURRENT_DATA_VERSION);

		assert.deepEqual(adapter.under(STORAGE), [
			`${STORAGE}/abc.drill.json`,
			`${STORAGE}/abc.json`,
		]);

		// Renamed, not deleted: the originals are still readable.
		assert.deepEqual(adapter.under(BACKUP), [
			`${BACKUP}/abc.drill.json`,
			`${BACKUP}/abc.json`,
		]);

		assert.equal(await adapter.exists(LEGACY), false);

		assert.equal(result.notices.length, 1);
		assert.match(result.notices[0], /moved 2 files into "Chess Repertoires"/);
		assert.match(result.notices[0], /storage_bak/);
	});

	it('leaves the version alone when a file could not be copied', async () => {
		const adapter = legacyVault();

		adapter.unreadable.add(`${LEGACY}/abc.json`);

		const result = await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		assert.equal(result.version, INITIAL_DATA_VERSION);

		// The old folder is untouched, so the retry has everything to work with.
		assert.equal(adapter.renames.length, 0);
		assert.equal(adapter.under(LEGACY).length, 2);

		assert.match(result.notices[0], /could not move 1 file/);
	});

	it('finishes on the next run once the unreadable file is readable', async () => {
		const adapter = legacyVault();

		adapter.unreadable.add(`${LEGACY}/abc.json`);

		const first = await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		adapter.unreadable.clear();

		const second = await runMigrations(first.version, context(adapter));

		assert.equal(second.version, CURRENT_DATA_VERSION);

		assert.deepEqual(adapter.under(STORAGE), [
			`${STORAGE}/abc.drill.json`,
			`${STORAGE}/abc.json`,
		]);
	});

	it('does nothing for a vault already at the current version', async () => {
		const adapter = legacyVault();

		const result = await runMigrations(CURRENT_DATA_VERSION, context(adapter));

		assert.equal(result.version, CURRENT_DATA_VERSION);
		assert.deepEqual(result.notices, []);
		assert.deepEqual(adapter.under(STORAGE), []);
	});

	it('is a no-op the second time even if the version is lost', async () => {
		const adapter = legacyVault();

		await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		const before = [...adapter.files.entries()].sort();

		// A vault whose settings were rolled back: the rename is what stops the
		// step doing anything a second time, not the recorded version.
		const result = await runMigrations(INITIAL_DATA_VERSION, context(adapter));

		assert.equal(result.version, CURRENT_DATA_VERSION);
		assert.deepEqual(result.notices, []);
		assert.deepEqual([...adapter.files.entries()].sort(), before);
	});

	it('migrates into whatever folder the vault is configured for', async () => {
		const adapter = legacyVault();

		await runMigrations(
			INITIAL_DATA_VERSION,
			context(adapter, 'Chess/Repertoires')
		);

		assert.deepEqual(adapter.under('Chess/Repertoires'), [
			'Chess/Repertoires/abc.drill.json',
			'Chess/Repertoires/abc.json',
		]);
	});

	it('reports the version every step claims, in order', () => {
		assert.deepEqual(
			MIGRATIONS.map((step) => step.version),
			MIGRATIONS.map((_, index) => index + 1)
		);

		assert.equal(MIGRATIONS[MIGRATIONS.length - 1].version, CURRENT_DATA_VERSION);
	});
});
