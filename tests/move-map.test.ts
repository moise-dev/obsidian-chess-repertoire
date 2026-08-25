import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	MapSegment,
	anchorMove,
	buildSegments,
	fenToBoard,
	findTranspositions,
	flattenSegments,
	layoutSegments,
	positionKey,
	toScoresheet,
} from '../src/lib/move-map';
import { ChessStudyMove } from '../src/lib/storage';

const mv = (
	san: string,
	variants: unknown[] = [],
	color: 'w' | 'b' = 'w',
	after = `position-${san}`
): ChessStudyMove =>
	({
		san,
		moveId: san,
		color,
		after,
		variants,
		shapes: [],
		comment: null,
	} as unknown as ChessStudyMove);

/** Alternating colours, the way a real line runs. */
const line = (...sans: string[]) =>
	sans.map((san, index) => mv(san, [], index % 2 ? 'b' : 'w'));

const va = (
	variantId: string,
	parentMoveId: string,
	moves: ChessStudyMove[]
) => ({ variantId, parentMoveId, moves });

/**
 *   mainline  a b c d
 *   b  ->  v1: x1 x2      (x1 -> v3: y1 y2)
 *          v2: z1
 *
 * So the line runs a b, then forks three ways after b: c d, x1 x2 and z1. x1
 * forks again into x2 and y1 y2.
 */
const tree = (): ChessStudyMove[] => [
	mv('a'),
	mv('b', [
		va('v1', 'b', [mv('x1', [va('v3', 'x1', [mv('y1'), mv('y2')])]), mv('x2')]),
		va('v2', 'b', [mv('z1')]),
	]),
	mv('c'),
	mv('d'),
];

const sans = (segment: MapSegment) =>
	segment.moves.map((move) => move.san).join(' ');

const at = (
	layout: { nodes: { segment: MapSegment; y: number; height: number }[] },
	id: string
) => layout.nodes.find((node) => node.segment.id === id)!;

const options = {
	cardWidth: 100,
	gapX: 20,
	gapY: 10,
	defaultHeight: 40,
};

describe('buildSegments', () => {
	it('has nothing to draw for an empty study', () => {
		assert.equal(buildSegments([]), null);
	});

	it('collapses a study with no branches into a single segment', () => {
		const root = buildSegments([mv('a'), mv('b'), mv('c')]);

		assert.equal(sans(root!), 'a b c');
		assert.deepEqual(root!.children, []);
	});

	it('ends a segment where the line forks', () => {
		const root = buildSegments(tree())!;

		assert.equal(sans(root), 'a b');
		assert.deepEqual(root.children.map(sans), ['c d', 'x1', 'z1']);
	});

	it('keeps forking inside a variation', () => {
		const root = buildSegments(tree())!;
		const x1 = root.children[1];

		assert.deepEqual(x1.children.map(sans), ['x2', 'y1 y2']);
	});

	it('names a segment by its first move and counts branch depth', () => {
		const root = buildSegments(tree())!;

		assert.equal(root.id, 'a');
		assert.equal(root.depth, 0);
		assert.deepEqual(
			root.children.map((child) => [child.id, child.depth]),
			[
				['c', 1],
				['x1', 1],
				['z1', 1],
			]
		);
		assert.equal(root.children[1].children[1].depth, 2);
	});

	it('numbers each segment from the ply its first move sits at', () => {
		const root = buildSegments(tree())!;

		// a b are plies 0 and 1, so every branch after b starts at ply 2, and the
		// fork after x1 starts at 3.
		assert.equal(root.startPly, 0);
		assert.deepEqual(
			root.children.map((child) => child.startPly),
			[2, 2, 2]
		);
		assert.deepEqual(
			root.children[1].children.map((child) => child.startPly),
			[3, 3]
		);
	});
});

describe('anchorMove', () => {
	it('shows the trunk where it hands over', () => {
		const root = buildSegments(tree())!;

		assert.equal(anchorMove(root)?.san, 'b');
	});

	it('shows a branch the move that opened it', () => {
		const root = buildSegments(tree())!;

		assert.deepEqual(
			root.children.map((child) => anchorMove(child)?.san),
			['c', 'x1', 'z1']
		);
	});

	it('shows a study with no branches its last move', () => {
		const root = buildSegments([mv('a'), mv('b'), mv('c')])!;

		assert.equal(anchorMove(root)?.san, 'c');
	});
});

describe('flattenSegments', () => {
	it('lists every segment, parents first', () => {
		const root = buildSegments(tree())!;

		assert.deepEqual(
			flattenSegments(root).map((segment) => segment.id),
			['a', 'c', 'x1', 'x2', 'y1', 'z1']
		);
	});
});

describe('layoutSegments', () => {
	it('puts a column per branch depth', () => {
		const layout = layoutSegments(buildSegments(tree())!, {}, options);
		const xOf = (id: string) =>
			layout.nodes.find((node) => node.segment.id === id)!.x;

		assert.equal(xOf('a'), 0);
		assert.equal(xOf('c'), 120);
		assert.equal(xOf('x2'), 240);
	});

	it('stacks the leaves without overlapping them', () => {
		const layout = layoutSegments(buildSegments(tree())!, {}, options);
		const leaves = ['c', 'x2', 'y1', 'z1'].map(
			(id) => layout.nodes.find((node) => node.segment.id === id)!
		);

		for (const [index, leaf] of leaves.slice(1).entries())
			assert.ok(leaf.y >= leaves[index].y + leaves[index].height);
	});

	it('centres a parent on the block its children occupy', () => {
		const layout = layoutSegments(buildSegments(tree())!, {}, options);
		const at = (id: string) =>
			layout.nodes.find((node) => node.segment.id === id)!;

		const x1 = at('x1');
		const [x2, y1] = [at('x2'), at('y1')];

		assert.equal(x1.y + x1.height / 2, (x2.y + (y1.y + y1.height)) / 2);
	});

	it('uses a measured height where it has one', () => {
		const layout = layoutSegments(buildSegments(tree())!, { c: 90 }, options);

		assert.equal(at(layout, 'c').height, 90);
		assert.equal(at(layout, 'x2').height, 40);
		// The taller card pushes everything below it down.
		assert.equal(at(layout, 'x2').y, 100);
	});

	it('reports the size of the whole diagram', () => {
		const layout = layoutSegments(buildSegments(tree())!, {}, options);

		// Three columns wide, four leaves tall.
		assert.equal(layout.width, 340);
		assert.equal(layout.height, 190);
	});

	it('draws an edge from each segment to the ones it forks into', () => {
		const layout = layoutSegments(buildSegments(tree())!, {}, options);

		assert.deepEqual(
			layout.edges.map((edge) => `${edge.from.segment.id}->${edge.to.segment.id}`),
			['x1->x2', 'x1->y1', 'a->c', 'a->x1', 'a->z1']
		);
	});
});

describe('toScoresheet', () => {
	// Plies count from 0, so ply 0 and 1 are move 1, ply 2 and 3 are move 2.
	const numberAtPly = (ply: number) => Math.floor(ply / 2) + 1;

	it('pairs the moves under their number', () => {
		const root = buildSegments(line('e4', 'e5', 'Nf3', 'Nc6'))!;

		assert.deepEqual(
			toScoresheet(root, numberAtPly).map((row) => [
				row.number,
				row.white?.san ?? null,
				row.black?.san ?? null,
			]),
			[
				[1, 'e4', 'e5'],
				[2, 'Nf3', 'Nc6'],
			]
		);
	});

	it('leaves the White column empty when a segment starts on Black', () => {
		const moves = line('e4', 'e5', 'Nf3', 'Nc6');
		// A branch after 2.Nf3 starts on Black's move, at ply 3.
		const segment = buildSegments(moves)!.children[0] ?? {
			...buildSegments(moves)!,
			startPly: 3,
			moves: moves.slice(3),
		};

		const rows = toScoresheet(segment, numberAtPly);

		assert.equal(rows[0].white, null);
		assert.equal(rows[0].black?.san, 'Nc6');
		assert.equal(rows[0].number, 2);
	});

	it('carries an odd move onto a row of its own', () => {
		const root = buildSegments(line('e4', 'e5', 'Nf3'))!;
		const rows = toScoresheet(root, numberAtPly);

		assert.equal(rows.length, 2);
		assert.equal(rows[1].white?.san, 'Nf3');
		assert.equal(rows[1].black, null);
	});
});

describe('positionKey', () => {
	it('keeps what is on the board and drops the clocks', () => {
		const board = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

		assert.equal(positionKey(`${board} 0 1`), board);
		// The same position by another move order disagrees about the clocks.
		assert.equal(positionKey(`${board} 3 9`), positionKey(`${board} 0 1`));
	});
});

describe('findTranspositions', () => {
	// A transposition needs the same san twice, so these moves are built with
	// explicit ids rather than through `mv`, which keys the id off the san.
	const tmv = (
		moveId: string,
		san: string,
		color: 'w' | 'b',
		after: string,
		variants: unknown[] = []
	): ChessStudyMove =>
		({
			moveId,
			san,
			color,
			after,
			variants,
			shapes: [],
			comment: null,
		} as unknown as ChessStudyMove);

	/**
	 *   mainline  d4 Nf6 c4 e6
	 *   d4  ->  v1: c4 e6 d4 Nf6
	 *
	 * Both lines stand in the same place after four moves.
	 */
	const transposing = () => [
		tmv('1', 'd4', 'w', 'A', [
			va('v1', '1', [
				tmv('5', 'c4', 'w', 'E'),
				tmv('6', 'e6', 'b', 'F'),
				tmv('7', 'd4', 'w', 'G'),
				tmv('8', 'Nf6', 'b', 'SAME'),
			]),
		]),
		tmv('2', 'Nf6', 'b', 'B'),
		tmv('3', 'c4', 'w', 'C'),
		tmv('4', 'e6', 'b', 'SAME'),
	];

	it('pairs up the moves that land in the same place', () => {
		const found = findTranspositions(buildSegments(transposing())!);

		assert.deepEqual([...found.keys()].sort(), ['4', '8']);
		assert.equal(found.get('4')?.[0].san, 'Nf6');
		assert.equal(found.get('8')?.[0].san, 'e6');
	});

	it('names the card the other line sits in', () => {
		const moves = transposing();
		const root = buildSegments(moves)!;
		const found = findTranspositions(root);

		const otherSegment = found.get('4')?.[0].segmentId;

		assert.ok(otherSegment);
		assert.notEqual(otherSegment, root.id);
	});

	it('ignores a position repeated inside one run of moves', () => {
		// A repetition, not a transposition: same card, so nothing to point at.
		const root = buildSegments([
			mv('Nf3', [], 'w', 'P'),
			mv('Nf6', [], 'b', 'Q'),
			mv('Ng1', [], 'w', 'P'),
		])!;

		assert.equal(findTranspositions(root).size, 0);
	});

	it('finds nothing in a study whose lines never meet', () => {
		assert.equal(findTranspositions(buildSegments(tree())!).size, 0);
	});
});

describe('fenToBoard', () => {
	it('expands the run-length ranks of a starting position', () => {
		const board = fenToBoard(
			'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
		);

		assert.equal(board.length, 8);
		assert.ok(board.every((rank) => rank.length === 8));
		assert.deepEqual(board[0], [...'rnbqkbnr']);
		assert.deepEqual(board[3], Array(8).fill(null));
		assert.deepEqual(board[7], [...'RNBQKBNR']);
	});

	it('reads a position part way through a game', () => {
		const board = fenToBoard('8/8/4k3/8/8/4K3/8/8 w - - 0 1');

		assert.equal(board[2][4], 'k');
		assert.equal(board[5][4], 'K');
		assert.equal(board[0].filter(Boolean).length, 0);
	});
});
