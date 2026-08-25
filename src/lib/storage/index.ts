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
// 0.0.6 adds `playerColor` to the study. Also optional; absent means the colour
// is not known yet and the board's orientation stands in.
export const CURRENT_STORAGE_VERSION = '0.0.6';

/** Drill records are their own file and their own version line. */
export const CURRENT_DRILL_VERSION = '0.0.1';

export interface Variant {
	variantId: string;
	parentMoveId: string;
	moves: ChessStudyMove[];
}

/** One move, anywhere in the tree: the mainline and every variation alike. */
export interface ChessStudyMove extends Move {
	moveId: string;
	variants: Variant[];
	shapes: DrawShape[];
	comment: JSONContent | null;
	classification?: MoveClassification | null;
	/**
	 * Keeps the move in the study but out of rehearsal, along with everything
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
 * Drill history for one study, kept beside it rather than inside it.
 *
 * The study is a document: it is autosaved, exported, and often kept in version
 * control, and stats that change on every drill would churn it for no reason.
 * They are also personal rather than part of the study, so a shared study does
 * not carry someone else's progress, and this file can be deleted on its own to
 * start over.
 */
export interface ChessStudyDrillData {
	version: string;
	/** Keyed by `moveId`, which is stable across edits elsewhere in the tree. */
	stats: Record<string, MoveDrillStats>;
}

export const emptyDrillData = (): ChessStudyDrillData => ({
	version: CURRENT_DRILL_VERSION,
	stats: {},
});

export interface ChessStudyFileData {
	version: string;
	header: { title: string | null };
	moves: ChessStudyMove[];
	rootFEN: string;
	/**
	 * The side the study is written for: the one whose moves are the mainline,
	 * with the variations holding the other side's replies.
	 *
	 * `'w' | 'b'` rather than the trainer's `'white' | 'black'`, to match the
	 * colour on a move. Absent in a study that has never said - the board's
	 * orientation stands in until one does.
	 */
	playerColor?: 'w' | 'b';
}

const normaliseMoves = (moves: ChessStudyMove[] | undefined): void => {
	if (!Array.isArray(moves)) return;

	for (const move of moves) {
		if (!Array.isArray(move.variants)) move.variants = [];

		for (const variant of move.variants) normaliseMoves(variant.moves);
	}
};

export class ChessStudyDataAdapter {
	adapter: DataAdapter;
	storagePath: string;

	constructor(adapter: DataAdapter, storagePath: string) {
		this.adapter = adapter;
		this.storagePath = storagePath;
	}

	async saveFile(data: ChessStudyFileData, id?: string) {
		const chessStudyId = id || nanoid();

		await this.adapter.write(
			normalizePath(`${this.storagePath}/${chessStudyId}.json`),
			JSON.stringify(data, null, 2),
			{}
		);

		return chessStudyId;
	}

	async loadFile(id: string): Promise<ChessStudyFileData> {
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

		return jsonData;
	}

	private drillPath(id: string) {
		return normalizePath(`${this.storagePath}/${id}.drill.json`);
	}

	/**
	 * Drill history for a study, or an empty record when there is none yet.
	 *
	 * Never throws: a missing or unreadable stats file means the study opens
	 * having forgotten what you got wrong, which is a far better failure than
	 * the study refusing to open at all.
	 */
	async loadDrillData(id: string): Promise<ChessStudyDrillData> {
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
			console.error(`chess-study: could not read the drill history for ${id}`, e);

			return emptyDrillData();
		}
	}

	async saveDrillData(id: string, data: ChessStudyDrillData) {
		// Compact rather than indented: nobody reads this by hand, and a drill
		// rewrites it every session.
		await this.adapter.write(this.drillPath(id), JSON.stringify(data), {});
	}

	async createStorageFolderIfNotExists() {
		const folderExists = await this.adapter.exists(this.storagePath);

		if (!folderExists) this.adapter.mkdir(this.storagePath);
	}
}
