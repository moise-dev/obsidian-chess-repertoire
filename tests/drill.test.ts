import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	chooseReply,
	collectExcludedMoveIds,
	getDrillableReplies,
	pruneDrillData,
	recordAttempt,
	resolveRepertoireColor,
	subtreeRecord,
	weighReplies,
} from '../src/lib/drill';
import {
	MoveTree,
	collectSubtree,
	flattenTree,
	getReplies,
} from '../src/lib/move-tree';
import { ChessRepertoireMove, MoveDrillStats } from '../src/lib/storage';

// Only the fields the drill model reads. The chess.js Move parts that take no
// part are left off rather than faked.
const mv = (
	san: string,
	options: {
		color?: 'w' | 'b';
		excluded?: boolean;
		variants?: unknown[];
	} = {}
): ChessRepertoireMove =>
	({
		san,
		moveId: san,
		color: options.color ?? 'w',
		excluded: options.excluded,
		variants: options.variants ?? [],
		shapes: [],
		comment: null,
	} as unknown as ChessRepertoireMove);

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessRepertoireMove[]
) => ({ variantId, parentMoveId, moves });

/**
 * White is the user. After 1.e4 Black has three replies: e5 on the mainline,
 * and c5 and e6 as variations hanging off e4.
 *
 *   mainline  e4 e5 Nf3
 *   e4  ->  v1: c5 Nc3
 *          v2: e6 d4
 *
 * Every san is distinct because `mv` keys `moveId` off it, and two moves
 * sharing an id would share a drill record.
 */
const tree = (): MoveTree => ({
	moves: [
		mv('e4', {
			variants: [
				va('v1', 'e4', [mv('c5', { color: 'b' }), mv('Nc3')]),
				va('v2', 'e4', [mv('e6', { color: 'b' }), mv('d4')]),
			],
		}),
		mv('e5', { color: 'b' }),
		mv('Nf3'),
	],
	rootVariants: [],
});

const sans = (moves: ChessRepertoireMove[]) =>
	moves.map((m) => m.san).join(' ');

const stats = (
	entries: Record<string, [attempts: number, misses: number]>
): Record<string, MoveDrillStats> =>
	Object.fromEntries(
		Object.entries(entries).map(([moveId, [attempts, misses]]) => [
			moveId,
			{ attempts, misses, lastSeen: 0 },
		])
	);

describe('resolveRepertoireColor', () => {
	it('takes the repertoire at its word', () => {
		assert.equal(resolveRepertoireColor('b', 'white'), 'b');
		assert.equal(resolveRepertoireColor('w', 'black'), 'w');
	});

	it('falls back to the way the board is turned', () => {
		assert.equal(resolveRepertoireColor(undefined, 'black'), 'b');
		assert.equal(resolveRepertoireColor(undefined, 'white'), 'w');
	});
});

describe('replies', () => {
	it('offers the continuation and the variations hanging off the move', () => {
		assert.equal(sans(getReplies(tree(), 'e4')), 'e5 c5 e6');
	});

	it('offers only the first move at a root with no alternatives', () => {
		assert.equal(sans(getReplies(tree(), null)), 'e4');
	});

	it('offers the alternative first moves too, where the root has any', () => {
		const t = tree();

		t.rootVariants.push(va('r1', '', [mv('c4'), mv('c6', { color: 'b' })]));

		assert.equal(sans(getReplies(t, null)), 'e4 c4');

		// And a drill will not play into one that has been excluded.
		t.rootVariants[0].moves[0].excluded = true;

		assert.equal(sans(getDrillableReplies(t, null)), 'e4');
	});

	it('ends the line where a move has no continuation', () => {
		assert.deepEqual(getReplies(tree(), 'Nf3'), []);
	});

	it('leaves out an excluded reply', () => {
		const t = tree();

		t.moves[0].variants[0].moves[0].excluded = true;

		assert.equal(sans(getDrillableReplies(t, 'e4')), 'e5 e6');
	});
});

describe('collectExcludedMoveIds', () => {
	it('finds nothing in a repertoire with no exclusions', () => {
		assert.equal(collectExcludedMoveIds(tree()).size, 0);
	});

	it('takes the rest of the line with the flagged move', () => {
		const t = tree();

		t.moves[1].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(t)], ['e5', 'Nf3']);
	});

	it('takes the variations hanging off it too, since they need it played', () => {
		const t = tree();

		t.moves[0].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(t)].sort(), [
			'Nc3',
			'Nf3',
			'c5',
			'd4',
			'e4',
			'e5',
			'e6',
		]);
	});

	it('leaves the line a variation branches from alone', () => {
		const t = tree();

		t.moves[0].variants[0].moves[0].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(t)], ['c5', 'Nc3']);
	});

	it('reads an alternative first move as its own line, not the mainline’s', () => {
		const t = tree();

		t.rootVariants.push(va('r1', '', [mv('c4'), mv('c6', { color: 'b' })]));

		// Excluding the mainline's first move cannot reach a line branching from
		// before it.
		t.moves[0].excluded = true;

		const spared = collectExcludedMoveIds(t);

		assert.ok(!spared.has('c4') && !spared.has('c6'));

		// And excluding the alternative takes its own line and nothing else.
		t.moves[0].excluded = undefined;
		t.rootVariants[0].moves[0].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(t)], ['c4', 'c6']);
	});
});

describe('subtrees', () => {
	it('collects the rest of the line and everything growing out of it', () => {
		assert.equal(sans(collectSubtree(tree(), 'e4')), 'e4 c5 Nc3 e6 d4 e5 Nf3');
	});

	it('collects only its own branch from inside a variation', () => {
		assert.equal(sans(collectSubtree(tree(), 'c5')), 'c5 Nc3');
	});

	it('flattens the whole tree', () => {
		assert.equal(flattenTree(tree()).length, 7);
	});
});

describe('subtreeRecord', () => {
	it("sums the user's moves under a reply and ignores the repertoire's own", () => {
		const t = tree();

		// c5 is the repertoire's own move, so its record must not count towards the
		// branch it opens.
		const record = subtreeRecord(
			t,
			t.moves[0].variants[0].moves[0],
			stats({ Nc3: [4, 3], c5: [9, 9] }),
			'w'
		);

		assert.deepEqual(record, { attempts: 4, misses: 3, undrilled: 0 });
	});

	it('reports nothing for a line never drilled', () => {
		const t = tree();

		assert.deepEqual(subtreeRecord(t, t.moves[0].variants[1].moves[0], {}, 'w'), {
			attempts: 0,
			misses: 0,
			undrilled: 1,
		});
	});

	it("counts the user's moves under a reply that have never been asked for", () => {
		const t = lopsided();

		// Nf3 answered, Bb5 and Ba4 further down the same line never reached.
		const record = subtreeRecord(t, t.moves[1], stats({ Nf3: [3, 1] }), 'w');

		assert.deepEqual(record, { attempts: 3, misses: 1, undrilled: 2 });
	});
});

/**
 * White is the user. After 1.e4 Black has two replies, and they are wildly
 * different sizes: e5 runs on for three more moves of White's, c5 stops after
 * one. Enough of a difference for the weighting to have to notice it.
 *
 *   mainline  e4 e5 Nf3 Nc6 Bb5 a6 Ba4
 *   e4  ->  v1: c5 Nc3
 */
const lopsided = (): MoveTree => ({
	moves: [
		mv('e4', {
			variants: [va('v1', 'e4', [mv('c5', { color: 'b' }), mv('Nc3')])],
		}),
		mv('e5', { color: 'b' }),
		mv('Nf3'),
		mv('Nc6', { color: 'b' }),
		mv('Bb5'),
		mv('a6', { color: 'b' }),
		mv('Ba4'),
	],
	rootVariants: [],
});

describe('weighReplies', () => {
	it('marks a never-drilled reply unseen', () => {
		const weighted = weighReplies(tree(), 'e4', {}, 'w');

		assert.deepEqual(
			weighted.map((reply) => reply.unseen),
			[true, true, true]
		);
	});

	it('weighs a missed line above a known one', () => {
		const t = tree();

		// Every line drilled, so nothing is unseen: e5 is answered perfectly, c5
		// is missed every time.
		const weighted = weighReplies(
			t,
			'e4',
			stats({ Nf3: [4, 0], Nc3: [4, 4], d4: [4, 2] }),
			'w'
		);

		assert.equal(sans(weighted.map((reply) => reply.move)), 'e5 c5 e6');
		assert.ok(weighted.every((reply) => !reply.unseen));

		const [byE5, byC5, byE6] = weighted.map((reply) => reply.weight);

		assert.ok(byC5 > byE6 && byE6 > byE5);
		// A line always answered correctly still comes up sometimes.
		assert.ok(byE5 > 0);
	});

	/**
	 * Without this the weight is a rate and nothing else, which says the same
	 * about a branch holding three moves never asked for as about one holding
	 * none - and a session then wanders as if it were tossing a coin, leaving
	 * the deep parts of a repertoire undrilled for hundreds of sessions.
	 */
	it('weighs a branch by how much of it has never been asked for', () => {
		const t = lopsided();

		// Both branches answered exactly as badly as each other, but c5's line is
		// finished and e5's has two moves still never reached.
		const [byE5, byC5] = weighReplies(
			t,
			'e4',
			stats({ Nf3: [10, 5], Nc3: [10, 5] }),
			'w'
		).map((reply) => reply.weight);

		assert.ok(
			byE5 > byC5,
			`the branch with unlearned moves under it should weigh more: ${byE5} vs ${byC5}`
		);
	});

	it('leaves the weighting to the miss rate once a position is fully drilled', () => {
		const t = lopsided();

		const [byE5, byC5] = weighReplies(
			t,
			'e4',
			stats({ Nf3: [10, 5], Bb5: [10, 5], Ba4: [10, 5], Nc3: [4, 0] }),
			'w'
		).map((reply) => reply.weight);

		// Nothing left unasked, so the coverage term is gone and these are the
		// plain rates: 0.15 + 15/30 and 0.15 + 0/4.
		assert.ok(Math.abs(byE5 - 0.65) < 1e-9, `expected 0.65, got ${byE5}`);
		assert.ok(Math.abs(byC5 - 0.15) < 1e-9, `expected 0.15, got ${byC5}`);
	});

	it('prefers the larger branch when neither has been drilled at all', () => {
		const [byE5, byC5] = weighReplies(lopsided(), 'e4', {}, 'w').map(
			(reply) => reply.weight
		);

		assert.ok(byE5 > byC5, `${byE5} vs ${byC5}`);
	});
});

describe('chooseReply', () => {
	it('returns null where the line ends', () => {
		assert.equal(
			chooseReply(tree(), 'Nf3', {}, 'w', () => 0),
			null
		);
	});

	it('draws only from the unseen replies while any remain', () => {
		const t = tree();

		// e5's line is the only one drilled, so a draw anywhere in the range must
		// still land on one of the other two.
		const drilled = stats({ Nf3: [4, 1] });

		for (const ticket of [0, 0.5, 0.999]) {
			const chosen = chooseReply(t, 'e4', drilled, 'w', () => ticket);

			assert.ok(chosen && chosen.san !== 'e5');
		}
	});

	it('never returns an excluded reply', () => {
		const t = tree();

		t.moves[0].variants[0].moves[0].excluded = true;
		t.moves[0].variants[1].moves[0].excluded = true;

		for (const ticket of [0, 0.5, 0.999]) {
			assert.equal(chooseReply(t, 'e4', {}, 'w', () => ticket)?.san, 'e5');
		}
	});

	it('ends the line when every reply is excluded', () => {
		const t = tree();

		t.moves[1].excluded = true;
		t.moves[0].variants[0].moves[0].excluded = true;
		t.moves[0].variants[1].moves[0].excluded = true;

		assert.equal(
			chooseReply(t, 'e4', {}, 'w', () => 0),
			null
		);
	});

	it('picks the last candidate rather than nothing when the draw overruns', () => {
		const t = tree();

		assert.equal(chooseReply(t, 'e4', {}, 'w', () => 1)?.san, 'e6');
	});
});

describe('recordAttempt', () => {
	it('counts a first answer', () => {
		const next = recordAttempt({}, 'Nf3', true, 1000);

		assert.deepEqual(next.Nf3, { attempts: 1, misses: 1, lastSeen: 1000 });
	});

	it('counts a correct answer as an attempt without a miss', () => {
		const next = recordAttempt(stats({ Nf3: [2, 1] }), 'Nf3', false, 1000);

		assert.deepEqual(next.Nf3, { attempts: 3, misses: 1, lastSeen: 1000 });
	});

	it('leaves the record it was given alone', () => {
		const before = stats({ Nf3: [2, 1] });

		recordAttempt(before, 'Nf3', true, 1000);

		assert.deepEqual(before.Nf3, { attempts: 2, misses: 1, lastSeen: 0 });
	});
});

describe('pruneDrillData', () => {
	it('drops records for moves the repertoire no longer has', () => {
		const data = {
			version: '0.0.1',
			stats: stats({ Nf3: [1, 0], gone: [3, 2] }),
		};

		const pruned = pruneDrillData(data, tree());

		assert.deepEqual(Object.keys(pruned.stats), ['Nf3']);
		assert.equal(pruned.version, data.version);
	});
});
