import { JSONContent } from '@tiptap/react';
import { Move } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { nanoid } from 'nanoid';
import { DataAdapter, normalizePath } from 'obsidian';
import { MoveClassification } from 'src/lib/classification';
import { ROOT_FEN } from 'src/main';

// 0.0.4 makes variations recursive: every move, wherever it sits, carries its
// own `variants`. Older files are normalised on load.
// 0.0.5 adds `excluded` to a move. It is optional and absent means drilled, so
// nothing has to be migrated.
// 0.0.6 adds `playerColor` to the repertoire. Also optional; absent means the colour
// is not known yet and the board's orientation stands in.
// 0.0.7 adds `rootVariants`: alternatives to the repertoire's first move, which
// have no move to hang off. Backfilled to `[]` on load.
export const CURRENT_STORAGE_VERSION = '0.0.7';

/** Drill records are their own file and their own version line. */
export const CURRENT_DRILL_VERSION = '0.0.1';

export interface Variant {
	variantId: string;
	/**
	 * The move this variation is an alternative to the continuation of.
	 *
	 * `ROOT_MOVE_ID` - the empty string - for a variation in `rootVariants`,
	 * which hangs off the root position rather than off a move.
	 */
	parentMoveId: string;
	moves: ChessRepertoireMove[];
}

/** One move, anywhere in the tree: the mainline and every variation alike. */
export interface ChessRepertoireMove extends Move {
	moveId: string;
	variants: Variant[];
	shapes: DrawShape[];
	comment: JSONContent | null;
	classification?: MoveClassification | null;
	/**
	 * Keeps the move in the repertoire but out of rehearsal, along with everything
	 * after it: a drill never plays into it and never asks for it.
	 *
	 * On the move itself rather than on the `Variant`, because the replies
	 * available at a position are a mix of one continuation and the variations
	 * hanging off the move before it. Those are different objects, but they are
	 * all moves, so one flag covers both - and it can also exclude a branch part
	 * way down a line the user otherwise drills.
	 */
	excluded?: boolean;
}

/** What repeated drills have learned about one move of the user's own. */
export interface MoveDrillStats {
	attempts: number;
	misses: number;
	/** Epoch millis of the last drill that asked for this move. */
	lastSeen: number;
}

/**
 * Drill history for one repertoire, kept beside it rather than inside it.
 *
 * The repertoire is a document: it is autosaved, exported, and often kept in version
 * control, and stats that change on every drill would churn it for no reason.
 * They are also personal rather than part of the repertoire, so a shared repertoire does
 * not carry someone else's progress, and this file can be deleted on its own to
 * start over.
 */
export interface ChessRepertoireDrillData {
	version: string;
	/** Keyed by `moveId`, which is stable across edits elsewhere in the tree. */
	stats: Record<string, MoveDrillStats>;
}

export const emptyDrillData = (): ChessRepertoireDrillData => ({
	version: CURRENT_DRILL_VERSION,
	stats: {},
});

export interface ChessRepertoireFileData {
	version: string;
	header: { title: string | null };
	moves: ChessRepertoireMove[];
	/**
	 * Alternatives to the repertoire's first move.
	 *
	 * Every other variation hangs off the move before the alternatives it holds,
	 * and the first move has no such move - so the ones belonging to the root
	 * position are kept here, beside the mainline they branch from. Together with
	 * `moves` this is the whole tree; `MoveTree` is the pair.
	 */
	rootVariants: Variant[];
	rootFEN: string;
	/**
	 * The side the repertoire is written for: the one whose moves are the mainline,
	 * with the variations holding the other side's replies.
	 *
	 * `'w' | 'b'` rather than the trainer's `'white' | 'black'`, to match the
	 * colour on a move. Absent in a repertoire that has never said - the board's
	 * orientation stands in until one does.
	 */
	playerColor?: 'w' | 'b';
}

const normaliseMoves = (moves: ChessRepertoireMove[] | undefined): void => {
	if (!Array.isArray(moves)) return;

	for (const move of moves) {
		if (!Array.isArray(move.variants)) move.variants = [];

		for (const variant of move.variants) normaliseMoves(variant.moves);
	}
};

export class ChessRepertoireDataAdapter {
	adapter: DataAdapter;
	storagePath: string;

	constructor(adapter: DataAdapter, storagePath: string) {
		this.adapter = adapter;
		this.storagePath = storagePath;
	}

	async saveFile(data: ChessRepertoireFileData, id?: string) {
		const chessRepertoireId = id || nanoid();

		await this.adapter.write(
			normalizePath(`${this.storagePath}/${chessRepertoireId}.json`),
			JSON.stringify(data, null, 2),
			{}
		);

		return chessRepertoireId;
	}

	async loadFile(id: string): Promise<ChessRepertoireFileData> {
		const data = await this.adapter.read(
			normalizePath(`${this.storagePath}/${id}.json`)
		);

		const jsonData = JSON.parse(data);

		//Make sure data is compatible with storage version 0.0.1.
		if (!jsonData.rootFEN) {
			jsonData.rootFEN = ROOT_FEN;
		}

		//Storage versions before 0.0.4 gave `variants` only to mainline moves.
		//Filling it in here means nothing downstream has to test for it.
		normaliseMoves(jsonData.moves);

		//Storage versions before 0.0.7 had nowhere to put an alternative to the
		//first move, so an older repertoire simply has none.
		if (!Array.isArray(jsonData.rootVariants)) jsonData.rootVariants = [];

		for (const variant of jsonData.rootVariants) normaliseMoves(variant.moves);

		return jsonData;
	}

	private drillPath(id: string) {
		return normalizePath(`${this.storagePath}/${id}.drill.json`);
	}

	/**
	 * Drill history for a repertoire, or an empty record when there is none yet.
	 *
	 * Never throws: a missing or unreadable stats file means the repertoire opens
	 * having forgotten what you got wrong, which is a far better failure than
	 * the repertoire refusing to open at all.
	 */
	async loadDrillData(id: string): Promise<ChessRepertoireDrillData> {
		const path = this.drillPath(id);

		try {
			if (!(await this.adapter.exists(path))) return emptyDrillData();

			const parsed = JSON.parse(await this.adapter.read(path));

			if (!parsed || typeof parsed.stats !== 'object') return emptyDrillData();

			return {
				version: parsed.version ?? CURRENT_DRILL_VERSION,
				stats: parsed.stats,
			};
		} catch (e) {
			console.error(
				`chess-repertoire: could not read the drill history for ${id}`,
				e
			);

			return emptyDrillData();
		}
	}

	async saveDrillData(id: string, data: ChessRepertoireDrillData) {
		// Compact rather than indented: nobody reads this by hand, and a drill
		// rewrites it every session.
		await this.adapter.write(this.drillPath(id), JSON.stringify(data), {});
	}

	async createStorageFolderIfNotExists() {
		const folderExists = await this.adapter.exists(this.storagePath);

		if (!folderExists) this.adapter.mkdir(this.storagePath);
	}
}
