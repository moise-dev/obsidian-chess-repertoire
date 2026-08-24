import { JSONContent } from '@tiptap/react';
import { Move } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { nanoid } from 'nanoid';
import { DataAdapter, normalizePath } from 'obsidian';
import { MoveClassification } from 'src/lib/classification';
import { ROOT_FEN } from 'src/main';

// 0.0.4 makes variations recursive: every move, wherever it sits, carries its
// own `variants`. Older files are normalised on load.
export const CURRENT_STORAGE_VERSION = '0.0.4';


export interface Variant {
	variantId: string;
	parentMoveId: string;
	moves: ChessStudyMove[];
}

/**
 * One move, anywhere in the tree. Mainline moves and variation moves used to be
 * separate types, which is what limited variations to a single level: only the
 * mainline kind carried `variants`.
 */
export interface ChessStudyMove extends Move {
	moveId: string;
	variants: Variant[];
	shapes: DrawShape[];
	comment: JSONContent | null;
	classification?: MoveClassification | null;
}

/** Kept as an alias so existing imports keep working. */
export type VariantMove = ChessStudyMove;

export interface ChessStudyFileData {
	version: string;
	header: { title: string | null };
	moves: ChessStudyMove[];
	rootFEN: string;
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

	async createStorageFolderIfNotExists() {
		const folderExists = await this.adapter.exists(this.storagePath);

		if (!folderExists) this.adapter.mkdir(this.storagePath);
	}
}
