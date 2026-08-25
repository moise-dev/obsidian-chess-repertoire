import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Chess } from 'chess.js';
import { isPromotionMove, playOtherSide } from '../src/lib/chess-logic';

const fakeCg = () => ({ set: () => undefined }) as unknown as Parameters<typeof playOtherSide>[0];

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
