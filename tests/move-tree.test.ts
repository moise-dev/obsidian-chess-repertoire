import { produce } from 'immer';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	MoveTree,
	ROOT_INDEX,
	ROOT_PATH,
	countTree,
	findMovePath,
	flattenTree,
	getContinuation,
	getListAtPath,
	getMoveAtPath,
	getParentMovePath,
	getReplies,
	moveVariationAtPath,
	pathDepth,
	plyAtPath,
	promoteToMainline,
	promoteVariationAtPath,
	removeMoveAtPath,
	removeMovesFromPath,
	removeVariationAtPath,
} from '../src/lib/move-tree';
import { ChessRepertoireMove } from '../src/lib/storage';

let seq = 0;
const makeId = () => `generated-${seq++}`;

// Only the fields the tree code touches; the chess.js Move parts are irrelevant
// to structure, so they are left off rather than faked.
const mv = (san: string, variants: unknown[] = []): ChessRepertoireMove =>
	({
		san,
		moveId: san,
		variants,
		shapes: [],
		comment: null,
	} as unknown as ChessRepertoireMove);

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessRepertoireMove[]
) => ({ variantId, parentMoveId, moves });

/**
 *   mainline  a b c d
 *   b  ->  v1: x1 x2      (x1 -> v3: y1 y2)
 *          v2: z1
 */
const tree = (): MoveTree =>
	JSON.parse(
		JSON.stringify({
			moves: [
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
			],
			rootVariants: [],
		})
	) as MoveTree;

const sans = (moves: ChessRepertoireMove[]) =>
	moves.map((m) => m.san).join(' ');
const pathOf = (t: MoveTree, id: string) => findMovePath(t, id)!;

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

		assert.equal(sans(t.moves), 'a b x1 x2');
		const b = getMoveAtPath(t, [1])!;
		assert.equal(sans(b.variants[0].moves), 'c d', 'old continuation demoted');
		assert.equal(b.variants[1].variantId, 'v2', 'sibling order preserved');
		assert.equal(countTree(t), countTree(tree()), 'no moves lost');
	});

	it('does not leave an empty variation when the parent had no continuation', () => {
		const t: MoveTree = {
			moves: [mv('a'), mv('b', [va('v1', 'b', [mv('x1')])])],
			rootVariants: [],
		};
		promoteVariationAtPath(t, pathOf(t, 'x1'), makeId);

		assert.equal(sans(t.moves), 'a b x1');
		assert.equal(getMoveAtPath(t, [1])!.variants.length, 0);
	});

	it('promotes the whole containing line, not just the clicked move', () => {
		const t = tree();
		promoteToMainline(t, 'y1', makeId);

		// y1's line opens with x1, so x1 comes up with it.
		assert.equal(sans(t.moves), 'a b x1 y1 y2');
		assert.equal(pathDepth(pathOf(t, 'y1')), 0);
		assert.equal(countTree(t), countTree(tree()), 'no moves lost');
		for (const survivor of ['c', 'd', 'x2', 'z1']) {
			assert.notEqual(findMovePath(t, survivor), null, `${survivor} survives`);
		}
	});

	it('refuses on the mainline', () => {
		const t = tree();
		assert.equal(promoteVariationAtPath(t, pathOf(t, 'c'), makeId), false);
		assert.equal(sans(t.moves), 'a b c d');
	});
});

describe('deleting a variation', () => {
	it('removes exactly its own subtree', () => {
		const t = tree();
		const before = countTree(t);

		removeVariationAtPath(t, pathOf(t, 'x1'));

		assert.equal(before - countTree(t), 4, 'x1, x2 and the nested y1, y2');
		assert.equal(sans(t.moves), 'a b c d', 'mainline untouched');
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
 * corrupt a repertoire rather than just render it oddly.
 */
describe('under immer', () => {
	it('promotes without losing or aliasing moves', () => {
		const before = tree();
		const after = produce(before, (draft) => {
			promoteToMainline(draft, 'y1', makeId);
		});

		assert.equal(sans(after.moves), 'a b x1 y1 y2');
		assert.equal(countTree(after), countTree(before));
		assert.equal(sans(before.moves), 'a b c d', 'the input is untouched');

		// Each move must appear exactly once in the new tree.
		const ids: string[] = [];
		const walk = (moves: ChessRepertoireMove[]) => {
			for (const move of moves) {
				ids.push(move.moveId);
				for (const variant of move.variants) walk(variant.moves);
			}
		};
		walk(after.moves);
		assert.equal(new Set(ids).size, ids.length, 'no move duplicated');
		assert.equal(ids.length, countTree(before), 'no move dropped');
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

	it('leaves the repertoire object identical when an operation is refused', () => {
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

describe('removeMovesFromPath', () => {
	it('truncates the mainline from the move down', () => {
		const after = produce(tree(), (draft) => {
			removeMovesFromPath(draft, pathOf(draft, 'c'));
		});

		assert.equal(sans(after.moves), 'a b');
	});

	it('counts everything it removed, nested variations included', () => {
		let count = 0;

		produce(tree(), (draft) => {
			count = removeMovesFromPath(draft, pathOf(draft, 'b'));
		});

		// b, its two variations (x1, y1, y2, x2 and z1), then c and d.
		assert.equal(count, 8);
	});

	it('takes the rest of a variation and leaves the line it branches from', () => {
		const after = produce(tree(), (draft) => {
			removeMovesFromPath(draft, pathOf(draft, 'x2'));
		});

		// The mainline is untouched, and x1 keeps the variation hanging off it.
		assert.equal(sans(after.moves), 'a b c d');
		assert.equal(sans(after.moves[1].variants[0].moves), 'x1');
		assert.notEqual(findMovePath(after, 'y2'), null);
		assert.equal(findMovePath(after, 'x2'), null);
	});

	it('removes the variation when it starts at its first move', () => {
		const after = produce(tree(), (draft) => {
			removeMovesFromPath(draft, pathOf(draft, 'x1'));
		});

		assert.equal(after.moves[1].variants.length, 1);
		assert.equal(sans(after.moves[1].variants[0].moves), 'z1');
		assert.equal(sans(after.moves), 'a b c d');
	});

	it('takes a nested variation down with the move it hangs off', () => {
		const after = produce(tree(), (draft) => {
			removeMovesFromPath(draft, pathOf(draft, 'x1'));
		});

		assert.equal(findMovePath(after, 'y1'), null);
	});

	it('empties the repertoire when it starts at the first move', () => {
		const after = produce(tree(), (draft) => {
			removeMovesFromPath(draft, pathOf(draft, 'a'));
		});

		assert.equal(after.moves.length, 0);
	});

	it('leaves the repertoire alone when the path is not in it', () => {
		const before = tree();
		const after = produce(before, (draft) => {
			removeMovesFromPath(draft, [9, 9, 9]);
		});

		assert.equal(after, before);
	});
});

/**
 * A repertoire that starts from a position rather than the standard array has a
 * real choice to make on its first move, so the root needs variations of its own.
 * They have no move to hang off, which is what makes them worth their own tests.
 */
describe('alternatives to the first move', () => {
	/**
	 *   mainline  a b
	 *   root  ->  r1: p q
	 *             r2: s      (s -> v9: n)
	 */
	const rooted = (): MoveTree =>
		JSON.parse(
			JSON.stringify({
				moves: [mv('a'), mv('b')],
				rootVariants: [
					va('r1', '', [mv('p'), mv('q')]),
					va('r2', '', [mv('s', [va('v9', 's', [mv('n')])])]),
				],
			})
		) as MoveTree;

	it('addresses them from the root', () => {
		const t = rooted();

		assert.deepEqual(pathOf(t, 'p'), [ROOT_INDEX, 0, 0]);
		assert.deepEqual(pathOf(t, 'q'), [ROOT_INDEX, 0, 1]);
		assert.deepEqual(pathOf(t, 'n'), [ROOT_INDEX, 1, 0, 0, 0]);
		assert.equal(getMoveAtPath(t, pathOf(t, 'n'))!.san, 'n');
		assert.equal(sans(getListAtPath(t, pathOf(t, 'q'))!), 'p q');
	});

	it('counts them as the mainline’s peers, not as nested variations', () => {
		const t = rooted();

		// Depth 0 like the mainline, so a line under a root alternative may nest
		// as deeply as one under the mainline.
		assert.equal(pathDepth(pathOf(t, 'p')), 0);
		assert.equal(pathDepth(pathOf(t, 'n')), 1);

		// The first move of an alternative sits at ply 0, beside the mainline's.
		assert.equal(plyAtPath(pathOf(t, 'p')), 0);
		assert.equal(plyAtPath(pathOf(t, 'q')), 1);
		assert.equal(plyAtPath(pathOf(t, 'n')), 1);
	});

	it('offers them all as replies at the root', () => {
		assert.equal(sans(getReplies(rooted(), null)), 'a p s');

		// The continuation is the mainline's alone: alternatives are choices made
		// instead of it, not moves that follow it.
		assert.equal(getContinuation(rooted(), null)!.san, 'a');
	});

	it('names the root as their parent, which is no move', () => {
		const t = rooted();

		assert.deepEqual(getParentMovePath(pathOf(t, 'p')), ROOT_PATH);
		assert.equal(getMoveAtPath(t, ROOT_PATH), null);
	});

	it('trades places with the mainline when promoted', () => {
		const t = rooted();
		promoteVariationAtPath(t, pathOf(t, 'p'), makeId);

		assert.equal(sans(t.moves), 'p q');
		assert.equal(sans(t.rootVariants[0].moves), 'a b', 'old mainline demoted');
		assert.equal(t.rootVariants[1].variantId, 'r2', 'sibling order preserved');
		assert.equal(countTree(t), countTree(rooted()), 'no moves lost');
	});

	it('promotes a nested line all the way onto the mainline', () => {
		const t = rooted();
		promoteToMainline(t, 'n', makeId);

		// n's line opens with s, so s comes up with it.
		assert.equal(sans(t.moves), 's n');
		assert.equal(countTree(t), countTree(rooted()), 'no moves lost');
		for (const survivor of ['a', 'b', 'p', 'q']) {
			assert.notEqual(findMovePath(t, survivor), null, `${survivor} survives`);
		}
	});

	it('reorders and deletes them like any other variation', () => {
		const t = rooted();

		assert.equal(moveVariationAtPath(t, pathOf(t, 's'), -1), true);
		assert.equal(t.rootVariants[0].variantId, 'r2');
		assert.equal(moveVariationAtPath(t, pathOf(t, 's'), -1), false);

		assert.equal(removeVariationAtPath(t, pathOf(t, 's')), true);
		assert.equal(t.rootVariants.length, 1);
		assert.equal(findMovePath(t, 'n'), null, 'its nested line goes too');
		assert.equal(sans(t.moves), 'a b', 'mainline untouched');
	});

	it('drops an alternative once its last move is removed', () => {
		const t = rooted();
		removeMovesFromPath(t, pathOf(t, 'p'));

		assert.equal(t.rootVariants.length, 1);
		assert.equal(t.rootVariants[0].variantId, 'r2');
	});

	it('seats an alternative on the mainline when the mainline is deleted', () => {
		const t = rooted();
		removeMovesFromPath(t, pathOf(t, 'a'));

		// Otherwise the alternatives would have nothing left to be alternatives
		// to, and no first move for the list to draw them under.
		assert.equal(sans(t.moves), 'p q');
		assert.equal(t.rootVariants.length, 1);
		assert.equal(t.rootVariants[0].variantId, 'r2');
	});

	it('counts and flattens the whole tree, alternatives included', () => {
		assert.equal(countTree(rooted()), 6);
		assert.equal(
			flattenTree(rooted())
				.map((move) => move.san)
				.sort()
				.join(' '),
			'a b n p q s'
		);
	});

	it('survives immer without losing or aliasing moves', () => {
		const before = rooted();
		const after = produce(before, (draft) => {
			promoteToMainline(draft, 'n', makeId);
		});

		assert.equal(sans(after.moves), 's n');
		assert.equal(countTree(after), countTree(before));
		assert.equal(sans(before.moves), 'a b', 'the input is untouched');

		const ids = flattenTree(after).map((move) => move.moveId);
		assert.equal(new Set(ids).size, ids.length, 'no move duplicated');
		assert.equal(ids.length, countTree(before), 'no move dropped');
	});
});
