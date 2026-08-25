import { getReplies } from 'src/lib/move-tree';
import { ChessStudyMove } from 'src/lib/storage';

/**
 * A run of moves with no choice in it, ending where the line branches.
 *
 * The unit the map draws. A repertoire read move by move is mostly filler: the
 * interesting positions are the ones where the opponent picks, and collapsing
 * everything between them is what turns a few hundred moves into a diagram that
 * fits on a screen.
 */
export interface MapSegment {
	/** The id of the segment's first move, which is unique across the tree. */
	id: string;
	moves: ChessStudyMove[];
	/** Half-move number of the first move, counting from 0 at the mainline's. */
	startPly: number;
	/** How many branch points sit above this segment. */
	depth: number;
	/** The replies available where this segment ends, each opening a segment. */
	children: MapSegment[];
}

const buildFrom = (
	moves: ChessStudyMove[],
	first: ChessStudyMove,
	startPly: number,
	depth: number
): MapSegment => {
	const run = [first];
	let cursor = first.moveId;

	// Walk while the line offers exactly one continuation. Two or more ends the
	// segment and opens a child for each; none ends it as a leaf.
	for (;;) {
		const replies = getReplies(moves, cursor);

		if (replies.length === 1) {
			run.push(replies[0]);
			cursor = replies[0].moveId;
			continue;
		}

		return {
			id: first.moveId,
			moves: run,
			startPly,
			depth,
			children: replies.map((reply) =>
				buildFrom(moves, reply, startPly + run.length, depth + 1)
			),
		};
	}
};

/** The whole study as segments, or null when it has no moves. */
export const buildSegments = (moves: ChessStudyMove[]): MapSegment | null => {
	const first = getReplies(moves, null)[0];

	return first ? buildFrom(moves, first, 0, 0) : null;
};

/** Every segment in the tree, parents before children. */
export const flattenSegments = (root: MapSegment): MapSegment[] => [
	root,
	...root.children.flatMap(flattenSegments),
];

export interface MapNode {
	segment: MapSegment;
	x: number;
	y: number;
	height: number;
}

export interface MapEdge {
	from: MapNode;
	to: MapNode;
}

export interface MapLayout {
	nodes: MapNode[];
	edges: MapEdge[];
	width: number;
	height: number;
}

export interface LayoutOptions {
	cardWidth: number;
	gapX: number;
	gapY: number;
	/** Used for a card that has not been measured yet. */
	defaultHeight: number;
}

/**
 * Places the segments in columns by depth and packs them vertically.
 *
 * Cards share one width, so a column's x follows from its depth alone and only
 * heights have to be measured. Leaves take the next free row; a parent centres
 * on the block its children occupy, which is what makes a fork read as one.
 *
 * The clamp against the last card placed in the same column is a safety net for
 * the one case centring can overlap: a parent taller than the whole span of its
 * children. A branch has at least two of them, so it rarely happens - but a
 * silent overlap would be worse than a card sitting slightly off centre.
 */
export const layoutSegments = (
	root: MapSegment,
	heights: Record<string, number>,
	options: LayoutOptions
): MapLayout => {
	const { cardWidth, gapX, gapY, defaultHeight } = options;
	const nodes: MapNode[] = [];
	const edges: MapEdge[] = [];
	const columnBottom: number[] = [];
	let nextRow = 0;

	const place = (segment: MapSegment): MapNode => {
		const height = heights[segment.id] ?? defaultHeight;
		const children = segment.children.map(place);

		let y;

		if (children.length) {
			const first = children[0];
			const last = children[children.length - 1];

			y = (first.y + last.y + last.height) / 2 - height / 2;
		} else {
			y = nextRow;
			nextRow += height + gapY;
		}

		y = Math.max(y, columnBottom[segment.depth] ?? 0);
		columnBottom[segment.depth] = y + height + gapY;

		const node: MapNode = {
			segment,
			x: segment.depth * (cardWidth + gapX),
			y,
			height,
		};

		nodes.push(node);
		for (const child of children) edges.push({ from: node, to: child });

		return node;
	};

	place(root);

	return {
		nodes,
		edges,
		width: Math.max(...nodes.map((node) => node.x)) + cardWidth,
		height: Math.max(...nodes.map((node) => node.y + node.height)),
	};
};

/** One line of a scoresheet: a move number and the two moves under it. */
export interface ScoresheetRow {
	number: number;
	white: ChessStudyMove | null;
	black: ChessStudyMove | null;
}

/**
 * A segment's moves paired up the way a scoresheet pairs them.
 *
 * Laying them out in fixed columns rather than letting them wrap is what keeps
 * a card readable: a long run reads down the numbers, and a segment that starts
 * on Black's move keeps its first row aligned with an empty White column rather
 * than shunting everything across by one.
 */
export const toScoresheet = (
	segment: MapSegment,
	numberAtPly: (ply: number) => number
): ScoresheetRow[] => {
	const rows: ScoresheetRow[] = [];

	for (const [index, move] of segment.moves.entries()) {
		const number = numberAtPly(segment.startPly + index);
		let row = rows[rows.length - 1];

		if (!row || row.number !== number) {
			row = { number, white: null, black: null };
			rows.push(row);
		}

		if (move.color === 'w') row.white = move;
		else row.black = move;
	}

	return rows;
};

/** The piece on each square of a FEN, rank 8 first, or null for an empty one. */
export const fenToBoard = (fen: string): (string | null)[][] =>
	fen
		.split(' ')[0]
		.split('/')
		.map((rank) =>
			[...rank].flatMap((char) =>
				/\d/.test(char) ? Array(Number(char)).fill(null) : [char]
			)
		);
