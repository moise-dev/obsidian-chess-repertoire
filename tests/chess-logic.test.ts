import { Chess } from 'chess.js';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	collectDrawnMoveIds,
	isPromotionMove,
	playOtherSide,
} from '../src/lib/chess-logic';
import { MoveTree } from '../src/lib/move-tree';
import { ChessRepertoireMove } from '../src/lib/storage';

const fakeCg = () =>
	({ set: () => undefined } as unknown as Parameters<typeof playOtherSide>[0]);

describe('isPromotionMove', () => {
	it('is true for a pawn move to the last rank', () => {
		const chess = new Chess('8/P7/8/8/8/8/8/k1K5 w - - 0 1');

		assert.equal(isPromotionMove(chess, 'a7', 'a8'), true);
	});

	it('is false for a move that does not promote', () => {
		const chess = new Chess();

		assert.equal(isPromotionMove(chess, 'e2', 'e4'), false);
	});
});

describe('playOtherSide', () => {
	it('promotes to a queen by default', () => {
		const chess = new Chess('8/P7/8/8/8/8/8/k1K5 w - - 0 1');

		const move = playOtherSide(fakeCg(), chess)('a7', 'a8');

		assert.equal(move.promotion, 'q');
	});

	it('promotes to whichever piece it is given', () => {
		const chess = new Chess('8/P7/8/8/8/8/8/k1K5 w - - 0 1');

		const move = playOtherSide(fakeCg(), chess)('a7', 'a8', 'n');

		assert.equal(move.promotion, 'n');
		assert.equal(chess.get('a8').type, 'n');
	});
});

/**
 * A drawn position is worked out from the board rather than stored, so these
 * are about the rules rather than about the file format.
 */
describe('collectDrawnMoveIds', () => {
	const ROOT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

	/** Plays `sans` out from `fen` and hands back a tree of that one line. */
	const line = (fen: string, sans: string[]): MoveTree => {
		const chess = new Chess(fen);

		return {
			moves: sans.map(
				(san) =>
					({
						...chess.move(san),
						moveId: san,
						variants: [],
						shapes: [],
						comment: null,
					} as unknown as ChessRepertoireMove)
			),
			rootVariants: [],
		};
	};

	it('finds nothing in an ordinary line', () => {
		const tree = line(ROOT_FEN, ['e4', 'e5', 'Nf3']);

		assert.equal(collectDrawnMoveIds(tree, ROOT_FEN).size, 0);
	});

	it('marks the move that stalemates', () => {
		// Black has only the king on h8; Qf7 leaves it with no legal move.
		const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
		const tree = line(fen, ['Qf7']);

		assert.deepEqual([...collectDrawnMoveIds(tree, fen)], ['Qf7']);
	});

	it('marks the move that leaves too little material to mate', () => {
		// Taking the last piece off leaves king against king.
		const fen = '7k/8/8/8/8/8/1q6/K7 w - - 0 1';
		const tree = line(fen, ['Kxb2']);

		assert.deepEqual([...collectDrawnMoveIds(tree, fen)], ['Kxb2']);
	});

	it('marks the move that completes the fifty-move rule', () => {
		const fen = '7k/8/8/8/8/8/R7/K7 w - - 99 80';
		const tree = line(fen, ['Ra3']);

		assert.deepEqual([...collectDrawnMoveIds(tree, fen)], ['Ra3']);
	});

	/**
	 * The reason the tree is replayed rather than each position read from its
	 * own FEN: a FEN cannot say a position has been reached before.
	 */
	it('marks a repetition, which no single position could show', () => {
		const sans = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
		const tree = line(ROOT_FEN, sans);

		assert.deepEqual([...collectDrawnMoveIds(tree, ROOT_FEN)], ['Ng8']);
	});

	/**
	 * chess.js 1.0.0-beta.6 does not check whether the side to move is in check
	 * before calling a position stalemate, so `isDraw` is true at checkmate too.
	 * Every mate in a repertoire would carry a ½ without this.
	 */
	it('does not call a checkmate a draw', () => {
		const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
		const tree = line(fen, ['Qf8#' as string]);

		assert.equal(tree.moves[0].san, 'Qf8#');
		assert.equal(collectDrawnMoveIds(tree, fen).size, 0);
	});

	it('looks inside variations and root alternatives alike', () => {
		const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
		const mainline = line(fen, ['Qa1']);
		const stalemating = line(fen, ['Qf7']);
		const nested = line(fen, ['Qb1']);

		// Qf7 stands beside the mainline as an alternative first move, and Qb1
		// hangs off the mainline's own first move.
		mainline.moves[0].variants.push({
			variantId: 'v',
			parentMoveId: 'Qa1',
			moves: nested.moves,
		});
		mainline.rootVariants.push({
			variantId: 'r',
			parentMoveId: '',
			moves: stalemating.moves,
		});

		assert.deepEqual([...collectDrawnMoveIds(mainline, fen)], ['Qf7']);
	});

	it('leaves the rest of the tree alone when a move will not play', () => {
		const fen = '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1';
		const tree = line(fen, ['Qa1']);

		// What a hand-edited file can hold: a move from a square with no piece.
		tree.moves[0] = {
			...tree.moves[0],
			from: 'h4',
			to: 'h5',
			moveId: 'bogus',
		} as ChessRepertoireMove;
		tree.rootVariants.push({
			variantId: 'r',
			parentMoveId: '',
			moves: line(fen, ['Qf7']).moves,
		});

		assert.deepEqual([...collectDrawnMoveIds(tree, fen)], ['Qf7']);
	});

	it('says nothing at all for a root FEN it cannot read', () => {
		assert.equal(
			collectDrawnMoveIds({ moves: [], rootVariants: [] }, 'not a fen').size,
			0
		);
	});
});
