import { JSONContent } from '@tiptap/react';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { getContinuations } from '../src/lib/move-tree';
import { ChessStudyMove } from '../src/lib/storage';
import { buildHintStages, errorShapes, hintShapes } from '../src/lib/trainer';

// Only the fields the trainer reads. The chess.js Move parts that do not take
// part - flags, piece, before/after - are left off rather than faked.
const mv = (
	san: string,
	options: {
		from?: string;
		to?: string;
		comment?: JSONContent | null;
		variants?: unknown[];
	} = {}
): ChessStudyMove =>
	({
		san,
		moveId: san,
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

const sans = (moves: ChessStudyMove[]) => moves.map((move) => move.san);

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

describe('getContinuations', () => {
	it('offers only the first mainline move from the root position', () => {
		assert.deepEqual(sans(getContinuations(tree(), null)), ['e4']);
	});

	it('offers the next move in the line, then any variation of it', () => {
		// A repertoire is a tree, so every branch you wrote down counts as a
		// correct answer - the mainline just comes first.
		assert.deepEqual(sans(getContinuations(tree(), 'e5')), ['Nf3', 'Nc6', 'd6']);
	});

	it('follows the line a variation move sits in, not the mainline', () => {
		assert.deepEqual(sans(getContinuations(tree(), 'Nc6')), ['Bc4']);
	});

	it('offers nothing at the end of a line', () => {
		assert.deepEqual(getContinuations(tree(), 'Nf3'), []);
		assert.deepEqual(getContinuations(tree(), 'd6'), []);
	});

	it('offers nothing for a move that is not in the study', () => {
		assert.deepEqual(getContinuations(tree(), 'nonsense'), []);
	});

	it('offers the variations of a move with no continuation of its own', () => {
		const moves = [mv('e4', { variants: [va('v1', 'e4', [mv('c5')])] })];

		assert.deepEqual(sans(getContinuations(moves, 'e4')), ['c5']);
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
