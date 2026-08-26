import {
	BISHOP,
	Chess,
	KNIGHT,
	PieceSymbol,
	QUEEN,
	ROOK,
	SQUARES,
	Square,
} from 'chess.js';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';
import { MoveTree } from 'src/lib/move-tree';
import { ChessRepertoireMove } from 'src/lib/storage';

/** Offered in this order, queen first as the common case. */
export const PROMOTION_PIECES: PieceSymbol[] = [QUEEN, ROOK, BISHOP, KNIGHT];

/**
 * Every move in the tree that leaves the game drawn, by id.
 *
 * Worked out rather than stored: it is a fact about the position, so a
 * repertoire file carries no trace of it, nothing has to be migrated, and no
 * saved flag can go stale when a line is edited underneath it.
 *
 * The tree is replayed on one board rather than each position being read back
 * from its own FEN, because threefold repetition is a fact about the moves that
 * led to a position and a FEN has forgotten them. Walking back out with `undo`
 * keeps that to one make and one unmake per move, however the tree branches.
 */
export const collectDrawnMoveIds = (
	tree: MoveTree,
	rootFEN: string
): Set<string> => {
	const drawn = new Set<string>();

	let chess: Chess;

	try {
		chess = new Chess(rootFEN);
	} catch {
		// An unreadable root FEN is the repertoire's problem, not this marker's.
		return drawn;
	}

	const walk = (moves: ChessRepertoireMove[]): void => {
		let played = 0;

		for (const move of moves) {
			try {
				chess.move({ from: move.from, to: move.to, promotion: move.promotion });
			} catch {
				// A hand-edited file can hold a move that will not play. The rest of
				// this line is unreachable, but the rest of the tree is not, so stop
				// here rather than giving up on the repertoire.
				break;
			}

			played++;

			// chess.js 1.0.0-beta.6 does not ask whether the side to move is in
			// check before calling a position stalemate, so it reports checkmate as
			// a draw. Mate is asked first, or every mating move would be marked ½.
			if (!chess.isCheckmate() && chess.isDraw()) drawn.add(move.moveId);

			// The variations hanging off this move are alternatives to the next one,
			// so they carry on from where the board stands now.
			for (const variant of move.variants ?? []) walk(variant.moves);
		}

		for (let i = 0; i < played; i++) chess.undo();
	};

	walk(tree.moves);

	// Each root alternative starts from the root position, which is where `walk`
	// has just put the board back to.
	for (const variant of tree.rootVariants) walk(variant.moves);

	return drawn;
};

export function toColor(chess: Chess) {
	return chess.turn() === 'w' ? 'white' : 'black';
}

/** Whether playing orig-dest promotes a pawn, and so needs a piece choice. */
export function isPromotionMove(chess: Chess, orig: Square, dest: Square) {
	return chess
		.moves({ square: orig, verbose: true })
		.some((m) => m.to === dest && m.promotion);
}

export function toDests(chess: Chess): Map<Square, Square[]> {
	const dests = new Map<Square, Square[]>();
	SQUARES.forEach((s) => {
		const ms = chess.moves({ square: s, verbose: true });
		if (ms.length)
			dests.set(
				s,
				ms.map((m) => m.to)
			);
	});
	return dests;
}

export function playOtherSide(cg: Api, chess: Chess) {
	return (orig: string, dest: string, promotion: PieceSymbol = QUEEN) => {
		const move = chess.move({ from: orig, to: dest, promotion });

		const commonTurnProperties: Partial<Config> = {
			turnColor: toColor(chess),
			movable: {
				color: toColor(chess),
				dests: toDests(chess),
			},
			check: chess.isCheck(),
		};

		if (move.flags === 'e' || move.promotion) {
			//Handle En Passant && the piece a promotion actually landed on
			cg.set({
				fen: chess.fen(),
				...commonTurnProperties,
			});
		} else {
			cg.set(commonTurnProperties);
		}

		return move;
	};
}
