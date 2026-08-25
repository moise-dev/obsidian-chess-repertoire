import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	chooseReply,
	collectExcludedMoveIds,
	getDrillableReplies,
	pruneDrillData,
	recordAttempt,
	subtreeRecord,
	weighReplies,
} from '../src/lib/drill';
import { collectSubtree, flattenMoves, getReplies } from '../src/lib/move-tree';
import { ChessStudyMove, MoveDrillStats } from '../src/lib/storage';

// Only the fields the drill model reads. The chess.js Move parts that take no
// part are left off rather than faked.
const mv = (
	san: string,
	options: {
		color?: 'w' | 'b';
		excluded?: boolean;
		variants?: unknown[];
	} = {}
): ChessStudyMove =>
	({
		san,
		moveId: san,
		color: options.color ?? 'w',
		excluded: options.excluded,
		variants: options.variants ?? [],
		shapes: [],
		comment: null,
	} as unknown as ChessStudyMove);

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessStudyMove[]
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
const tree = (): ChessStudyMove[] => [
	mv('e4', {
		variants: [
			va('v1', 'e4', [mv('c5', { color: 'b' }), mv('Nc3')]),
			va('v2', 'e4', [mv('e6', { color: 'b' }), mv('d4')]),
		],
	}),
	mv('e5', { color: 'b' }),
	mv('Nf3'),
];

const sans = (moves: ChessStudyMove[]) => moves.map((m) => m.san).join(' ');

const stats = (
	entries: Record<string, [attempts: number, misses: number]>
): Record<string, MoveDrillStats> =>
	Object.fromEntries(
		Object.entries(entries).map(([moveId, [attempts, misses]]) => [
			moveId,
			{ attempts, misses, lastSeen: 0 },
		])
	);

describe('replies', () => {
	it('offers the continuation and the variations hanging off the move', () => {
		assert.equal(sans(getReplies(tree(), 'e4')), 'e5 c5 e6');
	});

	it('offers only the first move at the root, which can have no alternatives', () => {
		assert.equal(sans(getReplies(tree(), null)), 'e4');
	});

	it('ends the line where a move has no continuation', () => {
		assert.deepEqual(getReplies(tree(), 'Nf3'), []);
	});

	it('leaves out an excluded reply', () => {
		const moves = tree();

		moves[0].variants[0].moves[0].excluded = true;

		assert.equal(sans(getDrillableReplies(moves, 'e4')), 'e5 e6');
	});
});

describe('collectExcludedMoveIds', () => {
	it('finds nothing in a study with no exclusions', () => {
		assert.equal(collectExcludedMoveIds(tree()).size, 0);
	});

	it('takes the rest of the line with the flagged move', () => {
		const moves = tree();

		moves[1].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(moves)], ['e5', 'Nf3']);
	});

	it('takes the variations hanging off it too, since they need it played', () => {
		const moves = tree();

		moves[0].excluded = true;

		assert.deepEqual(
			[...collectExcludedMoveIds(moves)].sort(),
			['Nc3', 'Nf3', 'c5', 'd4', 'e4', 'e5', 'e6']
		);
	});

	it('leaves the line a variation branches from alone', () => {
		const moves = tree();

		moves[0].variants[0].moves[0].excluded = true;

		assert.deepEqual([...collectExcludedMoveIds(moves)], ['c5', 'Nc3']);
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
		assert.equal(flattenMoves(tree()).length, 7);
	});
});

describe('subtreeRecord', () => {
	it("sums the user's moves under a reply and ignores the study's own", () => {
		const moves = tree();

		// c5 is the study's own move, so its record must not count towards the
		// branch it opens.
		const record = subtreeRecord(
			moves,
			moves[0].variants[0].moves[0],
			stats({ Nc3: [4, 3], c5: [9, 9] }),
			'w'
		);

		assert.deepEqual(record, { attempts: 4, misses: 3 });
	});

	it('reports nothing for a line never drilled', () => {
		const moves = tree();

		assert.deepEqual(
			subtreeRecord(moves, moves[0].variants[1].moves[0], {}, 'w'),
			{ attempts: 0, misses: 0 }
		);
	});
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
		const moves = tree();

		// Every line drilled, so nothing is unseen: e5 is answered perfectly, c5
		// is missed every time.
		const weighted = weighReplies(
			moves,
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
});

describe('chooseReply', () => {
	it('returns null where the line ends', () => {
		assert.equal(
			chooseReply(tree(), 'Nf3', {}, 'w', () => 0),
			null
		);
	});

	it('draws only from the unseen replies while any remain', () => {
		const moves = tree();

		// e5's line is the only one drilled, so a draw anywhere in the range must
		// still land on one of the other two.
		const drilled = stats({ Nf3: [4, 1] });

		for (const ticket of [0, 0.5, 0.999]) {
			const chosen = chooseReply(moves, 'e4', drilled, 'w', () => ticket);

			assert.ok(chosen && chosen.san !== 'e5');
		}
	});

	it('never returns an excluded reply', () => {
		const moves = tree();

		moves[0].variants[0].moves[0].excluded = true;
		moves[0].variants[1].moves[0].excluded = true;

		for (const ticket of [0, 0.5, 0.999]) {
			assert.equal(chooseReply(moves, 'e4', {}, 'w', () => ticket)?.san, 'e5');
		}
	});

	it('ends the line when every reply is excluded', () => {
		const moves = tree();

		moves[1].excluded = true;
		moves[0].variants[0].moves[0].excluded = true;
		moves[0].variants[1].moves[0].excluded = true;

		assert.equal(
			chooseReply(moves, 'e4', {}, 'w', () => 0),
			null
		);
	});

	it('picks the last candidate rather than nothing when the draw overruns', () => {
		const moves = tree();

		assert.equal(chooseReply(moves, 'e4', {}, 'w', () => 1)?.san, 'e6');
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
	it('drops records for moves the study no longer has', () => {
		const data = {
			version: '0.0.1',
			stats: stats({ Nf3: [1, 0], gone: [3, 2] }),
		};

		const pruned = pruneDrillData(data, tree());

		assert.deepEqual(Object.keys(pruned.stats), ['Nf3']);
		assert.equal(pruned.version, data.version);
	});
});
