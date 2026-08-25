import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CanvasCard, toCanvas } from '../src/lib/canvas';
import {
	buildSegments,
	flattenSegments,
	layoutSegments,
} from '../src/lib/move-map';
import { ChessStudyMove } from '../src/lib/storage';

const mv = (san: string, variants: unknown[] = []): ChessStudyMove =>
	({
		san,
		moveId: san,
		color: 'w',
		after: `position-${san}`,
		variants,
		shapes: [],
		comment: null,
	} as unknown as ChessStudyMove);

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessStudyMove[]
) => ({
	variantId,
	parentMoveId,
	moves,
});

/** a b, then a fork into c d and x1. */
const layout = () => {
	const root = buildSegments([
		mv('a'),
		mv('b', [va('v1', 'b', [mv('x1')])]),
		mv('c'),
		mv('d'),
	])!;

	return {
		root,
		layout: layoutSegments(
			root,
			{},
			{ cardWidth: 100, gapX: 20, gapY: 10, defaultHeight: 40 }
		),
	};
};

const cards = (root: ReturnType<typeof layout>['root']): CanvasCard[] =>
	flattenSegments(root).map((segment) => ({
		segmentId: segment.id,
		fen: `position-${segment.id} w KQkq - 0 1`,
		flipped: false,
		range: `${segment.depth + 1}`,
		moves: segment.moves.map((move) => move.san).join(' '),
		state: 'Never drilled',
		color: segment.depth ? '2' : undefined,
	}));

describe('toCanvas', () => {
	it('writes a node per card and an edge per fork', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root));

		assert.deepEqual(canvas.nodes.map((node) => node.id).sort(), [
			'a',
			'c',
			'x1',
		]);
		assert.deepEqual(
			canvas.edges.map((edge) => `${edge.fromNode}->${edge.toNode}`).sort(),
			['a->c', 'a->x1']
		);
	});

	it('keeps the shape of the diagram, scaled up', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root));

		const at = (id: string) => canvas.nodes.find((node) => node.id === id)!;

		// The map put the second column at x=120.
		assert.equal(at('a').x, 0);
		assert.equal(at('c').x, 192);
	});

	it('sizes a card to what is on it rather than to the map', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root));

		const at = (id: string) => canvas.nodes.find((node) => node.id === id)!;

		assert.ok(canvas.nodes.every((node) => node.height >= 300));
		// Every card here holds one short line of moves, so all are the same
		// height - the map's own would have made the trunk the tall one.
		assert.equal(at('a').height, at('x1').height);
	});

	it('writes the range, a board, the moves and the state as markdown', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root));

		const trunk = canvas.nodes.find((node) => node.id === 'a')!;

		assert.equal(
			trunk.text,
			'**1**\n\n```chessPosition\nfen: position-a w KQkq - 0 1\n```\n\na b\n\n*Never drilled*'
		);
	});

	it('turns the boards round for a study written for Black', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(
			placed,
			cards(root).map((card) => ({ ...card, flipped: true }))
		);

		assert.ok(canvas.nodes[0].text.includes('orientation: black'));
	});

	it('colours a card only where there is a colour to give', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root));

		assert.equal(canvas.nodes.find((node) => node.id === 'a')!.color, undefined);
		assert.equal(canvas.nodes.find((node) => node.id === 'x1')!.color, '2');
	});
});
