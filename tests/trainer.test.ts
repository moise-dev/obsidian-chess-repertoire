import { JSONContent } from '@tiptap/react';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getContinuation } from '../src/lib/move-tree';
import { ChessStudyMove } from '../src/lib/storage';
import {
	buildHintStages,
	errorShapes,
	hintShapes,
	moveNumberLabel,
	recordMistake,
} from '../src/lib/trainer';

// Only the fields the trainer reads. The chess.js Move parts that do not take
// part - flags, piece, before/after - are left off rather than faked.
const mv = (
	san: string,
	options: {
		from?: string;
		to?: string;
		color?: 'w' | 'b';
		comment?: JSONContent | null;
		variants?: unknown[];
	} = {}
): ChessStudyMove =>
	({
		san,
		moveId: san,
		color: options.color ?? 'w',
		from: options.from ?? 'e2',
		to: options.to ?? 'e4',
		comment: options.comment ?? null,
		variants: options.variants ?? [],
		shapes: [],
	} as unknown as ChessStudyMove);

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessStudyMove[]
) => ({ variantId, parentMoveId, moves });

const note = (text: string): JSONContent => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/**
 *   mainline  e4 e5 Nf3
 *   e5  ->  v1: Nc6 Bc4
 *           v2: d6
 */
const tree = (): ChessStudyMove[] => [
	mv('e4'),
	mv('e5', {
		variants: [
			va('v1', 'e5', [mv('Nc6'), mv('Bc4')]),
			va('v2', 'e5', [mv('d6')]),
		],
	}),
	mv('Nf3'),
];

const san = (move: ChessStudyMove | null) => move?.san ?? null;

describe('getContinuation', () => {
	it('starts a line at the first mainline move', () => {
		assert.equal(san(getContinuation(tree(), null)), 'e4');
	});

	it('offers the next move in the line, never a variation of it', () => {
		// Nc6 and d6 are alternatives to Nf3, not answers alongside it: the
		// drill holds you to the line it is running.
		assert.equal(san(getContinuation(tree(), 'e5')), 'Nf3');
	});

	it('follows the line a variation move sits in, not the mainline', () => {
		assert.equal(san(getContinuation(tree(), 'Nc6')), 'Bc4');
	});

	it('offers nothing at the end of a line', () => {
		assert.equal(getContinuation(tree(), 'Nf3'), null);
		assert.equal(getContinuation(tree(), 'd6'), null);
	});

	it('offers nothing for a move that is not in the study', () => {
		assert.equal(getContinuation(tree(), 'nonsense'), null);
	});

	it('offers nothing after a move whose only sequels are variations', () => {
		const moves = [mv('e4', { variants: [va('v1', 'e4', [mv('c5')])] })];

		assert.equal(getContinuation(moves, 'e4'), null);
	});

	it('offers nothing at all for an empty study', () => {
		assert.equal(getContinuation([], null), null);
	});
});

describe('buildHintStages', () => {
	it('hands out the note, then the piece, then the arrow', () => {
		const expected = mv('Nf3', {
			from: 'g1',
			to: 'f3',
			comment: note('Develop towards the centre.'),
		});

		assert.deepEqual(buildHintStages(expected, null), [
			{ kind: 'comment', text: 'Develop towards the centre.' },
			{ kind: 'piece', from: 'g1' },
			{ kind: 'arrow', from: 'g1', to: 'f3' },
		]);
	});

	it('falls back to the note on the move just played', () => {
		const previous = mv('e5', { comment: note('Now White must decide.') });
		const stages = buildHintStages(mv('Nf3', { from: 'g1', to: 'f3' }), previous);

		assert.deepEqual(stages[0], {
			kind: 'comment',
			text: 'Now White must decide.',
		});
	});

	it('leaves the comment out when there is no note to quote', () => {
		// An empty TipTap document still serialises to a paragraph, so "has a
		// comment" is not the same as "has something to say".
		const empty: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };
		const stages = buildHintStages(
			mv('Nf3', { from: 'g1', to: 'f3', comment: empty }),
			null
		);

		assert.deepEqual(
			stages.map((stage) => stage.kind),
			['piece', 'arrow']
		);
	});

	it('has nothing to offer at the end of a line', () => {
		assert.deepEqual(buildHintStages(null, mv('e4')), []);
	});
});

describe('board marks', () => {
	it('draws only the marks for the hints revealed so far', () => {
		const stages = buildHintStages(
			mv('Nf3', { from: 'g1', to: 'f3', comment: note('Develop.') }),
			null
		);

		// The comment is text, not a mark, so the first hint leaves the board be.
		assert.deepEqual(hintShapes(stages.slice(0, 1)), []);
		assert.deepEqual(hintShapes(stages.slice(0, 2)), [
			{ orig: 'g1', brush: 'blue' },
		]);
		assert.deepEqual(hintShapes(stages), [
			{ orig: 'g1', brush: 'blue' },
			{ orig: 'g1', dest: 'f3', brush: 'blue' },
		]);
	});

	it('marks a refused move in red', () => {
		assert.deepEqual(errorShapes({ from: 'd2', to: 'd4' }), [
			{ orig: 'd2', dest: 'd4', brush: 'red' },
		]);
	});
});

describe('moveNumberLabel', () => {
	/**
	 *   mainline  1. e4 e5  2. Nf3
	 *   e5  ->  v1: 2. Bc4 Nc6
	 */
	const line: ChessStudyMove[] = [
		mv('e4'),
		mv('e5', {
			color: 'b',
			variants: [va('v1', 'e5', [mv('Bc4'), mv('Nc6', { color: 'b' })])],
		}),
		mv('Nf3'),
	];

	it('numbers mainline moves, with dots for Black', () => {
		assert.equal(moveNumberLabel(line, line[0], 'w', 1), '1.');
		assert.equal(moveNumberLabel(line, line[1], 'w', 1), '1...');
		assert.equal(moveNumberLabel(line, line[2], 'w', 1), '2.');
	});

	it('numbers a variation from the move it branches off', () => {
		const [bishop, knight] = line[1].variants[0].moves;

		assert.equal(moveNumberLabel(line, bishop, 'w', 1), '2.');
		assert.equal(moveNumberLabel(line, knight, 'w', 1), '2...');
	});

	it('counts from the first move number the study starts at', () => {
		// A study opened from a FEN can start mid-game, and on Black's move.
		const midGame: ChessStudyMove[] = [mv('Nf6', { color: 'b' }), mv('c4')];

		assert.equal(moveNumberLabel(midGame, midGame[0], 'b', 12), '12...');
		assert.equal(moveNumberLabel(midGame, midGame[1], 'b', 12), '13.');
	});
});

describe('recordMistake', () => {
	const mistake = {
		atMoveId: 'e5',
		label: '2.',
		played: 'Qh5',
		expected: 'Nf3',
	};

	it('adds a mistake the tally has not seen', () => {
		assert.deepEqual(recordMistake([], mistake), [{ ...mistake, count: 1 }]);
	});

	it('counts the same wrong move in the same position only once', () => {
		// One thing you do not know, played twice - not two things.
		const tally = recordMistake(recordMistake([], mistake), mistake);

		assert.equal(tally.length, 1);
		assert.equal(tally[0].count, 2);
	});

	it('keeps a different wrong move in the same position apart', () => {
		const tally = recordMistake(recordMistake([], mistake), {
			...mistake,
			played: 'f4',
		});

		assert.deepEqual(
			tally.map((entry) => entry.played),
			['Qh5', 'f4']
		);
	});

	it('keeps the same wrong move in another position apart', () => {
		// Two lines can reach the same move number, so the label cannot be the
		// thing that tells positions apart.
		const tally = recordMistake(recordMistake([], mistake), {
			...mistake,
			atMoveId: 'c5',
		});

		assert.equal(tally.length, 2);
	});

	it('leaves the tally it was given alone', () => {
		const before = recordMistake([], mistake);
		recordMistake(before, mistake);

		assert.equal(before[0].count, 1);
	});
});
