import { normalizePath } from 'obsidian';
import { countTree } from 'src/lib/move-tree';
import { ChessRepertoireFileData } from 'src/lib/storage';

/**
 * Which files in the storage folder no longer belong to anything.
 *
 * A repertoire's file is written the moment the board is made, before its code
 * block reaches the note, and nothing removes it when the block goes away - so
 * a board thought better of, or a note deleted, leaves a json behind under a
 * name that means nothing to read. Merging leaves the originals too, on
 * purpose. This is what the cleanup command uses to find them.
 *
 * Given the vault's contents rather than reaching for them, so the rules about
 * what counts as unused can be tested without a vault.
 */

/** The drill history for a repertoire, beside it under the same id. */
const DRILL_SUFFIX = '.drill.json';

const JSON_SUFFIX = '.json';

/**
 * Extensions worth reading when looking for a repertoire's id.
 *
 * Markdown is where the blocks are; a canvas holds notes as strings inside its
 * json, and a card can be written by hand. Anything else in a vault is either
 * binary or not somewhere a code block renders.
 */
export const isSearchableNote = (extension: string): boolean =>
	extension === 'md' || extension === 'canvas' || extension === 'txt';

/**
 * Whether a file is inside the folder the search is limited to.
 *
 * An empty folder - the default - is the whole vault. Narrowing it is a
 * promise that every reference lives under there: a note outside is not read,
 * and the repertoire it names looks like one nothing uses.
 */
export const isInSearchFolder = (path: string, folder: string): boolean => {
	if (!folder.trim()) return true;

	const normalized = normalizePath(folder);

	//`normalizePath` answers '/' for an empty path, which is the vault root and
	//therefore no limit at all.
	if (normalized === '/') return true;

	return path.startsWith(`${normalized}/`);
};

/** A file to be searched for references, read only if it comes to that. */
export interface SearchableNote {
	path: string;
	read(): Promise<string>;
}

/** The slice of Obsidian's `DataAdapter` the scan uses. */
export interface CleanupFileAdapter {
	list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
	read(normalizedPath: string): Promise<string>;
	exists(normalizedPath: string): Promise<boolean>;
}

/** A repertoire's id and every file in the folder written under it. */
export interface StorageFileGroup {
	id: string;
	/** The repertoire, its drill history, or only one of the two. */
	paths: string[];
}

/**
 * The id a storage file was written under, or nothing when the name is not one
 * the plugin writes.
 *
 * The drill suffix is tested first: `<id>.drill.json` ends in `.json` as well,
 * and reading it as a repertoire would invent an id of `<id>.drill` that
 * nothing refers to - which is exactly the shape this hunts for, so the wrong
 * answer here would delete a drill history that is still in use.
 */
export const storageFileId = (path: string): string | null => {
	const name = path.split('/').pop() ?? '';

	for (const suffix of [DRILL_SUFFIX, JSON_SUFFIX])
		if (name.length > suffix.length && name.endsWith(suffix))
			return name.slice(0, -suffix.length);

	return null;
};

/** Every file in the folder, gathered under the id it belongs to. */
export const groupStorageFiles = (paths: string[]): StorageFileGroup[] => {
	const groups = new Map<string, StorageFileGroup>();

	for (const path of paths) {
		const id = storageFileId(path);

		if (!id) continue;

		const group = groups.get(id) ?? { id, paths: [] };

		group.paths.push(path);
		groups.set(id, group);
	}

	return [...groups.values()];
};

/**
 * The ids of `candidates` that appear anywhere in `content`.
 *
 * A plain substring search rather than a walk over the note's code blocks: an
 * id can also be sitting in a template, a canvas card, or a line of prose
 * saying which repertoire to come back to, and this is deciding what to
 * delete. A match that turns out to be a coincidence costs a file left on
 * disk; a reference missed costs a repertoire.
 */
export const referencedIn = (
	content: string,
	candidates: Iterable<string>
): string[] => [...candidates].filter((id) => content.includes(id));

/** Whether a parsed file has the shape of a repertoire this plugin wrote. */
export const looksLikeRepertoire = (
	parsed: unknown
): parsed is ChessRepertoireFileData => {
	if (typeof parsed !== 'object' || parsed === null) return false;

	const { moves, rootFEN, version } = parsed as Partial<ChessRepertoireFileData>;

	//A repertoire always has its moves, whether or not any have been played. The
	//other two have been optional at some point in the format's life, so either
	//one standing alone is enough.
	return (
		Array.isArray(moves) &&
		(typeof rootFEN === 'string' || typeof version === 'string')
	);
};

/** The same, for a drill history: the one file an id can have on its own. */
export const looksLikeDrillData = (parsed: unknown): boolean =>
	typeof parsed === 'object' &&
	parsed !== null &&
	typeof (parsed as { stats?: unknown }).stats === 'object' &&
	(parsed as { stats?: unknown }).stats !== null;

const plural = (count: number, one: string, many: string): string =>
	`${count} ${count === 1 ? one : many}`;

/**
 * How an unused file is named in the confirmation.
 *
 * The filename is an id and says nothing, so the repertoire is described by
 * what is in it: the title it carries if it has one, and how much would go
 * with it. A board made and never played reads as "Untitled - no moves", which
 * is the whole reason it is safe to say yes to.
 */
export const describeRepertoire = (
	repertoire: ChessRepertoireFileData | null
): string => {
	if (!repertoire) return 'drill history whose repertoire is already gone';

	const title = repertoire.header?.title?.trim();

	//`rootVariants` arrived in storage 0.0.7 and a file written before it has
	//none; nothing has run `loadFile` over this one to fill it in.
	const moves = countTree({
		moves: repertoire.moves,
		rootVariants: repertoire.rootVariants ?? [],
	});

	return `${title || 'Untitled'}, ${
		moves ? plural(moves, 'move', 'moves') : 'no moves'
	}`;
};

/** One id nothing in the vault refers to, and what deleting it would remove. */
export interface UnusedRepertoire extends StorageFileGroup {
	description: string;
}

export interface UnusedScan {
	unused: UnusedRepertoire[];
	/**
	 * Files in the folder that could not be read, or that did not look like
	 * anything the plugin writes. Left alone whether or not a note refers to
	 * them: the folder is a folder in the vault, and something else may be
	 * keeping its own files there.
	 */
	skipped: number;
}

/**
 * Every repertoire in `storagePath` that no note in `notes` refers to.
 *
 * Two passes, in the order that does the least work: the ids in the folder are
 * the candidates, and each note read strikes off the ones it mentions, until
 * the notes run out or nothing is left to look for. Only what survives that is
 * read and checked, so a vault full of repertoires in use costs one scan and
 * no parsing at all.
 *
 * Throws if a note cannot be read. Deleting on a partial reading of the vault
 * would be deleting on the strength of a reference that might be in the file
 * that failed, so the caller is expected to abandon the run rather than work
 * with what came back.
 */
export const findUnusedRepertoires = async (
	adapter: CleanupFileAdapter,
	storagePath: string,
	notes: SearchableNote[]
): Promise<UnusedScan> => {
	const folder = normalizePath(storagePath);

	if (!(await adapter.exists(folder))) return { unused: [], skipped: 0 };

	const { files } = await adapter.list(folder);

	const groups = new Map(
		groupStorageFiles(files).map((group) => [group.id, group])
	);

	for (const note of notes) {
		if (!groups.size) break;

		for (const id of referencedIn(await note.read(), groups.keys()))
			groups.delete(id);
	}

	const unused: UnusedRepertoire[] = [];

	let skipped = 0;

	for (const group of groups.values()) {
		const repertoirePath = group.paths.find(
			(path) => !path.endsWith(DRILL_SUFFIX)
		);

		try {
			if (repertoirePath) {
				const parsed = JSON.parse(await adapter.read(repertoirePath)) as unknown;

				if (!looksLikeRepertoire(parsed)) {
					skipped += 1;

					continue;
				}

				unused.push({ ...group, description: describeRepertoire(parsed) });

				continue;
			}

			//Nothing but a drill history under this id: the repertoire it belonged to
			//is already gone, and the stats are ours to clear away with it.
			const parsed = JSON.parse(await adapter.read(group.paths[0])) as unknown;

			if (!looksLikeDrillData(parsed)) {
				skipped += 1;

				continue;
			}

			unused.push({ ...group, description: describeRepertoire(null) });
		} catch (e) {
			console.error(
				`chess-repertoire: could not check whether ${group.id} is still used`,
				e
			);

			skipped += 1;
		}
	}

	return { unused, skipped };
};

/** How many files would actually go. A repertoire can have a drill history too. */
export const unusedFileCount = (unused: UnusedRepertoire[]): number =>
	unused.reduce((total, { paths }) => total + paths.length, 0);

/**
 * One line per file about to be deleted: the name on disk, and what is in it.
 *
 * The name is the only thing that will still be true once the file is in the
 * trash and the only way to find it again, so it leads - but a nanoid says
 * nothing about what would be lost, which is what the description is for.
 */
export const unusedFileLines = (unused: UnusedRepertoire[]): string[] =>
	unused.flatMap(({ paths, description }) =>
		paths.map((path) => {
			const name = path.split('/').pop() ?? path;

			return `${name} - ${
				path.endsWith(DRILL_SUFFIX) ? 'drill history' : description
			}`;
		})
	);
