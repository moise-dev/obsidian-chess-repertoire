import { produce } from 'immer';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	countMoves,
	findMovePath,
	getListAtPath,
	getMoveAtPath,
	getParentMovePath,
	moveVariationAtPath,
	pathDepth,
	plyAtPath,
	promoteToMainline,
	promoteVariationAtPath,
	removeMoveAtPath,
	removeVariationAtPath,
} from '../src/lib/move-tree';
import { ChessStudyMove } from '../src/lib/storage';

let seq = 0;
const makeId = () => `generated-${seq++}`;

// Only the fields the tree code touches; the chess.js Move parts are irrelevant
// to structure, so they are left off rather than faked.
const mv = (san: string, variants: unknown[] = []): ChessStudyMove =>
	({
		san,
		moveId: san,
		variants,
		shapes: [],
		comment: null,
	} as unknown as ChessStudyMove);

const va = (variantId: string, parentMoveId: string, moves: ChessStudyMove[]) =>
	({ variantId, parentMoveId, moves });

/**
 *   mainline  a b c d
 *   b  ->  v1: x1 x2      (x1 -> v3: y1 y2)
 *          v2: z1
 */
const tree = (): ChessStudyMove[] =>
	JSON.parse(
		JSON.stringify([
			mv('a'),
			mv('b', [
				va('v1', 'b', [
					mv('x1', [va('v3', 'x1', [mv('y1'), mv('y2')])]),
					mv('x2'),
				]),
				va('v2', 'b', [mv('z1')]),
			]),
			mv('c'),
			mv('d'),
		])
	);

const sans = (moves: ChessStudyMove[]) => moves.map((m) => m.san).join(' ');
const pathOf = (t: ChessStudyMove[], id: string) => findMovePath(t, id)!;

describe('addressing', () => {
	it('finds moves at every depth', () => {
		const t = tree();
		assert.deepEqual(pathOf(t, 'b'), [1]);
		assert.deepEqual(pathOf(t, 'x1'), [1, 0, 0]);
		assert.deepEqual(pathOf(t, 'y2'), [1, 0, 0, 0, 1]);
		assert.equal(findMovePath(t, 'nope'), null);
	});

	it('reports depth and ply', () => {
		const t = tree();
		assert.equal(pathDepth(pathOf(t, 'b')), 0);
		assert.equal(pathDepth(pathOf(t, 'x1')), 1);
		assert.equal(pathDepth(pathOf(t, 'y1')), 2);

		// A variation off a move at ply p starts at ply p + 1.
		assert.equal(plyAtPath([1]), 1);
		assert.equal(plyAtPath(pathOf(t, 'x1')), 2);
		assert.equal(plyAtPath(pathOf(t, 'y1')), 3);
	});

	it('resolves moves, lists and parents', () => {
		const t = tree();
		assert.equal(getMoveAtPath(t, pathOf(t, 'y2'))!.san, 'y2');
		assert.equal(sans(getListAtPath(t, pathOf(t, 'x2'))!), 'x1 x2');
		assert.deepEqual(getParentMovePath(pathOf(t, 'x1')), [1]);
		assert.equal(getParentMovePath([1]), null);
	});
});

describe('removing a move', () => {
	it('unwinds variations the deletion emptied, at every level', () => {
		const t = tree();
		removeMoveAtPath(t, pathOf(t, 'y2'));
		removeMoveAtPath(t, pathOf(t, 'y1'));

		assert.equal(findMovePath(t, 'y1'), null);
		assert.equal(getMoveAtPath(t, pathOf(t, 'x1'))!.variants.length, 0);
		assert.notEqual(findMovePath(t, 'x1'), null);
	});
});

describe('promoting a variation', () => {
	it('swaps it with the line it branches from', () => {
		const t = tree();
		promoteVariationAtPath(t, pathOf(t, 'x1'), makeId);

		assert.equal(sans(t), 'a b x1 x2');
		const b = getMoveAtPath(t, [1])!;
		assert.equal(sans(b.variants[0].moves), 'c d', 'old continuation demoted');
		assert.equal(b.variants[1].variantId, 'v2', 'sibling order preserved');
		assert.equal(countMoves(t), countMoves(tree()), 'no moves lost');
	});

	it('does not leave an empty variation when the parent had no continuation', () => {
		const t: ChessStudyMove[] = [mv('a'), mv('b', [va('v1', 'b', [mv('x1')])])];
		promoteVariationAtPath(t, pathOf(t, 'x1'), makeId);

		assert.equal(sans(t), 'a b x1');
		assert.equal(getMoveAtPath(t, [1])!.variants.length, 0);
	});

	it('promotes the whole containing line, not just the clicked move', () => {
		const t = tree();
		promoteToMainline(t, 'y1', makeId);

		// y1's line opens with x1, so x1 comes up with it.
		assert.equal(sans(t), 'a b x1 y1 y2');
		assert.equal(pathDepth(pathOf(t, 'y1')), 0);
		assert.equal(countMoves(t), countMoves(tree()), 'no moves lost');
		for (const survivor of ['c', 'd', 'x2', 'z1']) {
			assert.notEqual(findMovePath(t, survivor), null, `${survivor} survives`);
		}
	});

	it('refuses on the mainline', () => {
		const t = tree();
		assert.equal(promoteVariationAtPath(t, pathOf(t, 'c'), makeId), false);
		assert.equal(sans(t), 'a b c d');
	});
});

describe('deleting a variation', () => {
	it('removes exactly its own subtree', () => {
		const t = tree();
		const before = countMoves(t);

		removeVariationAtPath(t, pathOf(t, 'x1'));

		assert.equal(before - countMoves(t), 4, 'x1, x2 and the nested y1, y2');
		assert.equal(sans(t), 'a b c d', 'mainline untouched');
		assert.notEqual(findMovePath(t, 'z1'), null, 'sibling untouched');
	});

	it('deletes only the nested variation when given one of its moves', () => {
		const t = tree();
		removeVariationAtPath(t, pathOf(t, 'y1'));

		assert.equal(findMovePath(t, 'y1'), null);
		assert.notEqual(findMovePath(t, 'x1'), null);
		assert.notEqual(findMovePath(t, 'x2'), null);
	});
});

describe('reordering variations', () => {
	it('moves among siblings and stops at the ends', () => {
		const t = tree();
		const variantsOfB = () => getMoveAtPath(t, [1])!.variants;

		assert.equal(moveVariationAtPath(t, pathOf(t, 'z1'), -1), true);
		assert.equal(variantsOfB()[0].variantId, 'v2');
		assert.equal(moveVariationAtPath(t, pathOf(t, 'z1'), -1), false);

		assert.equal(moveVariationAtPath(t, pathOf(t, 'z1'), 1), true);
		assert.equal(variantsOfB()[0].variantId, 'v1');
	});

	it('refuses on the mainline', () => {
		const t = tree();
		assert.equal(moveVariationAtPath(t, pathOf(t, 'c'), 1), false);
	});
});

/**
 * The reducer runs these inside an immer draft, and they move draft objects
 * between arrays. Worth proving separately: a structural-sharing bug here would
 * corrupt a study rather than just render it oddly.
 */
describe('under immer', () => {
	it('promotes without losing or aliasing moves', () => {
		const before = tree();
		const after = produce(before, (draft) => {
			promoteToMainline(draft, 'y1', makeId);
		});

		assert.equal(sans(after), 'a b x1 y1 y2');
		assert.equal(countMoves(after), countMoves(before));
		assert.equal(sans(before), 'a b c d', 'the input is untouched');

		// Each move must appear exactly once in the new tree.
		const ids: string[] = [];
		const walk = (moves: ChessStudyMove[]) => {
			for (const move of moves) {
				ids.push(move.moveId);
				for (const variant of move.variants) walk(variant.moves);
			}
		};
		walk(after);
		assert.equal(new Set(ids).size, ids.length, 'no move duplicated');
		assert.equal(ids.length, countMoves(before), 'no move dropped');
	});

	it('deletes a variation without disturbing the rest', () => {
		const before = tree();
		const after = produce(before, (draft) => {
			removeVariationAtPath(draft, findMovePath(draft, 'x1')!);
		});

		assert.equal(findMovePath(after, 'x1'), null);
		assert.notEqual(findMovePath(after, 'z1'), null);
		assert.notEqual(findMovePath(before, 'x1'), null, 'the input is untouched');
	});

	it('leaves the study object identical when an operation is refused', () => {
		const before = tree();
		const after = produce(before, (draft) => {
			// c is on the mainline, so there is nothing to promote.
			promoteVariationAtPath(draft, findMovePath(draft, 'c')!, makeId);
		});

		// Identity matters: the autosave effect keys off it, so a refused action
		// must not look like a change.
		assert.equal(after, before);
	});
});
