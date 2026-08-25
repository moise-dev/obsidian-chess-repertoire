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
		range: `${segment.depth + 1}`,
		moves: segment.moves.map((move) => move.san).join(' '),
		state: segment.depth ? 'Never drilled' : null,
		color: segment.depth ? '2' : undefined,
	}));

describe('toCanvas', () => {
	it('writes a node per card and an edge per fork', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root), { cardWidth: 100 });

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
		const canvas = toCanvas(placed, cards(root), { cardWidth: 100 });

		const at = (id: string) => canvas.nodes.find((node) => node.id === id)!;

		// The map put the second column at x=120 and cards 100 wide.
		assert.equal(at('a').x, 0);
		assert.equal(at('c').x, 192);
		assert.equal(at('a').width, 160);
	});

	it('never gives a card less room than it can be read in', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root), { cardWidth: 100 });

		assert.ok(canvas.nodes.every((node) => node.height >= 120));
	});

	it('writes the range, the moves and the state as markdown', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root), { cardWidth: 100 });

		const trunk = canvas.nodes.find((node) => node.id === 'a')!;
		const branch = canvas.nodes.find((node) => node.id === 'x1')!;

		assert.equal(trunk.text, '**1**\n\na b');
		assert.equal(branch.text, '**2**\n\nx1\n\n*Never drilled*');
	});

	it('colours a card only where there is a colour to give', () => {
		const { root, layout: placed } = layout();
		const canvas = toCanvas(placed, cards(root), { cardWidth: 100 });

		assert.equal(canvas.nodes.find((node) => node.id === 'a')!.color, undefined);
		assert.equal(canvas.nodes.find((node) => node.id === 'x1')!.color, '2');
	});
});
