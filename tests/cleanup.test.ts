import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	CleanupFileAdapter,
	SearchableNote,
	findUnusedRepertoires,
	groupStorageFiles,
	isInSearchFolder,
	isSearchableNote,
	storageFileId,
	unusedFileCount,
	unusedFileLines,
} from '../src/lib/cleanup';

const STORAGE = 'Chess Repertoires';

/** An in-memory stand-in for the part of `DataAdapter` the scan touches. */
class FakeAdapter implements CleanupFileAdapter {
	files = new Map<string, string>();
	unreadable = new Set<string>();

	constructor(files: Record<string, string> = {}) {
		for (const [path, content] of Object.entries(files))
			this.files.set(path, content);
	}

	exists(path: string): Promise<boolean> {
		const prefix = `${path}/`;

		return Promise.resolve(
			this.files.has(path) ||
				[...this.files.keys()].some((existing) => existing.startsWith(prefix))
		);
	}

	list(path: string): Promise<{ files: string[]; folders: string[] }> {
		const prefix = `${path}/`;

		return Promise.resolve({
			files: [...this.files.keys()].filter((existing) =>
				existing.startsWith(prefix)
			),
			folders: [],
		});
	}

	read(path: string): Promise<string> {
		if (this.unreadable.has(path))
			return Promise.reject(new Error(`unreadable: ${path}`));

		const content = this.files.get(path);

		if (content === undefined)
			return Promise.reject(new Error(`missing: ${path}`));

		return Promise.resolve(content);
	}
}

const move = (san: string) => ({ san, variants: [] });

const repertoire = (title: string | null, moves: string[] = []) =>
	JSON.stringify({
		version: '0.0.7',
		header: { title },
		moves: moves.map(move),
		rootVariants: [],
		rootFEN: 'start',
	});

const drillData = () =>
	JSON.stringify({ version: '0.0.1', stats: { abc: { attempts: 1 } } });

/** A note whose reads are counted, so the early exit can be tested. */
class FakeNote implements SearchableNote {
	reads = 0;

	constructor(public path: string, private content: string) {}

	read(): Promise<string> {
		this.reads += 1;

		return Promise.resolve(this.content);
	}
}

const block = (id: string) =>
	['```chessRepertoire', `chessRepertoireId: ${id}`, '```'].join('\n');

describe('isSearchableNote', () => {
	it('reads the file types a block can be written in', () => {
		assert.equal(isSearchableNote('md'), true);
		assert.equal(isSearchableNote('canvas'), true);
		assert.equal(isSearchableNote('txt'), true);
	});

	it('leaves everything else alone', () => {
		for (const extension of ['json', 'png', 'pdf'])
			assert.equal(isSearchableNote(extension), false);
	});
});

describe('storageFileId', () => {
	it('reads the id off a repertoire', () => {
		assert.equal(storageFileId(`${STORAGE}/abc.json`), 'abc');
	});

	it('reads the id off a drill history rather than inventing one', () => {
		assert.equal(storageFileId(`${STORAGE}/abc.drill.json`), 'abc');
	});

	it('ignores a file the plugin does not write', () => {
		assert.equal(storageFileId(`${STORAGE}/notes.md`), null);
		assert.equal(storageFileId(`${STORAGE}/.json`), null);
	});
});

describe('groupStorageFiles', () => {
	it('gathers a repertoire and its drill history under one id', () => {
		assert.deepEqual(
			groupStorageFiles([
				`${STORAGE}/abc.json`,
				`${STORAGE}/abc.drill.json`,
				`${STORAGE}/def.json`,
				`${STORAGE}/readme.md`,
			]),
			[
				{ id: 'abc', paths: [`${STORAGE}/abc.json`, `${STORAGE}/abc.drill.json`] },
				{ id: 'def', paths: [`${STORAGE}/def.json`] },
			]
		);
	});
});

describe('findUnusedRepertoires', () => {
	it('finds nothing when the folder is not there', async () => {
		const scan = await findUnusedRepertoires(new FakeAdapter(), STORAGE, []);

		assert.deepEqual(scan, { unused: [], skipped: 0 });
	});

	it('leaves a repertoire a note renders alone', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian'),
			[`${STORAGE}/abc.drill.json`]: drillData(),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, [
			new FakeNote('Openings.md', block('abc')),
		]);

		assert.deepEqual(scan.unused, []);
	});

	it('counts a mention outside a block as a reference', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian'),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, [
			new FakeNote('Canvas.canvas', '{"nodes":[{"text":"come back to abc"}]}'),
		]);

		assert.deepEqual(scan.unused, []);
	});

	it('returns a repertoire no note mentions, with its drill history', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian', ['e4']),
			[`${STORAGE}/orphan.json`]: repertoire(null),
			[`${STORAGE}/orphan.drill.json`]: drillData(),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, [
			new FakeNote('Openings.md', block('abc')),
		]);

		assert.deepEqual(scan.unused, [
			{
				id: 'orphan',
				paths: [`${STORAGE}/orphan.json`, `${STORAGE}/orphan.drill.json`],
				description: 'Untitled, no moves',
			},
		]);
	});

	it('describes a repertoire by its title and size', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian', ['e4', 'e5', 'Nf3']),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, []);

		assert.equal(scan.unused[0].description, 'Italian, 3 moves');
	});

	it('takes a drill history whose repertoire is already gone', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/gone.drill.json`]: drillData(),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, []);

		assert.deepEqual(scan.unused, [
			{
				id: 'gone',
				paths: [`${STORAGE}/gone.drill.json`],
				description: 'drill history whose repertoire is already gone',
			},
		]);
	});

	it('leaves a json the plugin did not write where it is', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/settings.json`]: JSON.stringify({ theme: 'dark' }),
		});

		const scan = await findUnusedRepertoires(adapter, STORAGE, []);

		assert.deepEqual(scan.unused, []);
		assert.equal(scan.skipped, 1);
	});

	it('leaves a file it could not read where it is', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian'),
		});

		adapter.unreadable.add(`${STORAGE}/abc.json`);

		const scan = await findUnusedRepertoires(adapter, STORAGE, []);

		assert.deepEqual(scan.unused, []);
		assert.equal(scan.skipped, 1);
	});

	it('gives up rather than answering from a half-read vault', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian'),
		});

		await assert.rejects(
			findUnusedRepertoires(adapter, STORAGE, [
				{
					path: 'Broken.md',
					read: () => Promise.reject(new Error('unreadable')),
				},
			])
		);
	});

	it('stops reading notes once every repertoire is accounted for', async () => {
		const adapter = new FakeAdapter({
			[`${STORAGE}/abc.json`]: repertoire('Italian'),
		});

		const first = new FakeNote('Openings.md', block('abc'));
		const second = new FakeNote('Diary.md', 'Nothing to do with chess.');

		await findUnusedRepertoires(adapter, STORAGE, [first, second]);

		assert.equal(first.reads, 1);
		assert.equal(second.reads, 0);
	});
});

describe('isInSearchFolder', () => {
	it('takes the whole vault when no folder is named', () => {
		assert.equal(isInSearchFolder('Anywhere/Note.md', ''), true);
		assert.equal(isInSearchFolder('Anywhere/Note.md', '   '), true);
		assert.equal(isInSearchFolder('Anywhere/Note.md', '/'), true);
	});

	it('keeps to the folder that was named', () => {
		assert.equal(isInSearchFolder('Chess/Openings.md', 'Chess'), true);
		assert.equal(isInSearchFolder('Chess/Black/Sicilian.md', 'Chess'), true);
		assert.equal(isInSearchFolder('Diary/2026.md', 'Chess'), false);
	});

	it('does not take a folder whose name merely starts the same', () => {
		assert.equal(isInSearchFolder('Chess Notes/Openings.md', 'Chess'), false);
	});
});

describe('unusedFileLines', () => {
	const unused = [
		{
			id: 'abc',
			paths: [`${STORAGE}/abc.json`, `${STORAGE}/abc.drill.json`],
			description: 'Italian, 3 moves',
		},
	];

	it('counts every file, drill history included', () => {
		assert.equal(unusedFileCount(unused), 2);
	});

	it('names each file and says what is in it', () => {
		assert.deepEqual(unusedFileLines(unused), [
			'abc.json - Italian, 3 moves',
			'abc.drill.json - drill history',
		]);
	});
});
