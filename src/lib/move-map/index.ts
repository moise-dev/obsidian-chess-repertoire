import { MoveTree, getReplies, positionKey } from 'src/lib/move-tree';
import { ChessRepertoireMove } from 'src/lib/storage';

/**
 * The id of the card standing for the starting position itself.
 *
 * Only drawn where the repertoire offers more than one first move, which is what
 * an imported position tends to: the fork has to hang off something, and there
 * is no move to hang it off. A `moveId` is a nanoid, so this cannot collide.
 */
export const ROOT_SEGMENT_ID = 'root';

/**
 * A run of moves with no choice in it, ending where the line branches.
 *
 * The unit the map draws. A repertoire read move by move is mostly filler: the
 * interesting positions are the ones where the opponent picks, and collapsing
 * everything between them is what turns a few hundred moves into a diagram that
 * fits on a screen.
 */
export interface MapSegment {
	/**
	 * The id of the segment's first move, which is unique across the tree, or
	 * `ROOT_SEGMENT_ID` for the starting position's own card.
	 */
	id: string;
	/** Empty only for the root card, which stands for a position, not a run. */
	moves: ChessRepertoireMove[];
	/** Half-move number of the first move, counting from 0 at the mainline's. */
	startPly: number;
	/** How many branch points sit above this segment. */
	depth: number;
	/** The replies available where this segment ends, each opening a segment. */
	children: MapSegment[];
}

const buildFrom = (
	tree: MoveTree,
	first: ChessRepertoireMove,
	startPly: number,
	depth: number
): MapSegment => {
	const run = [first];
	let cursor = first.moveId;

	// Walk while the line offers exactly one continuation. Two or more ends the
	// segment and opens a child for each; none ends it as a leaf.
	for (;;) {
		const replies = getReplies(tree, cursor);

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
				buildFrom(tree, reply, startPly + run.length, depth + 1)
			),
		};
	}
};

/**
 * The whole repertoire as segments, or null when it has no moves.
 *
 * A repertoire recording more than one first move forks before any move is
 * played, so the trunk is the starting position itself: a card with no moves on
 * it, showing the board the alternatives branch from. With a single first move -
 * every repertoire that starts from the standard array, and most that do not -
 * the trunk is that move's own run, exactly as before.
 */
export const buildSegments = (tree: MoveTree): MapSegment | null => {
	const replies = getReplies(tree, null);

	if (!replies.length) return null;

	if (replies.length === 1) return buildFrom(tree, replies[0], 0, 0);

	return {
		id: ROOT_SEGMENT_ID,
		moves: [],
		startPly: 0,
		depth: 0,
		children: replies.map((reply) => buildFrom(tree, reply, 0, 1)),
	};
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

/** The other place a position turns up. */
export interface Transposition {
	moveId: string;
	/** The segment holding that move, so the map can go to its card. */
	segmentId: string;
	san: string;
}

/**
 * Moves that reach a position some other line also reaches, keyed by move id.
 *
 * Only across segments. The same position appearing twice inside one run of
 * moves would be a repetition rather than a transposition, and saying so on
 * both would be noise.
 *
 * Per move rather than per card, because a position is reached by a move: a
 * card can hold a dozen of them, and flagging the whole card would not say
 * which.
 */
export const findTranspositions = (
	root: MapSegment
): Map<string, Transposition[]> => {
	const byPosition = new Map<string, Transposition[]>();

	for (const segment of flattenSegments(root))
		for (const move of segment.moves) {
			const key = positionKey(move.after);
			const found = byPosition.get(key) ?? [];

			found.push({ moveId: move.moveId, segmentId: segment.id, san: move.san });
			byPosition.set(key, found);
		}

	const transpositions = new Map<string, Transposition[]>();

	for (const group of byPosition.values()) {
		if (group.length < 2) continue;

		for (const entry of group) {
			const elsewhere = group.filter(
				(other) => other.segmentId !== entry.segmentId
			);

			if (elsewhere.length) transpositions.set(entry.moveId, elsewhere);
		}
	}

	return transpositions;
};

/**
 * The move whose position a card shows: the last one on it, so every card shows
 * where its run of moves arrives.
 *
 * A card that forks therefore shows the position its children branch from, and
 * a card that ends a line shows how the line ends - the mate, the drawn
 * position, the endgame reached. Showing the *first* move instead left the
 * branches off one position looking like one another, since they differ from it
 * and from each other by a single move, while the card they hang off sat a move
 * behind the fork it was illustrating.
 *
 * Null only for the starting position's own card, which has no moves; the map
 * falls back to the repertoire's root FEN there.
 */
export const anchorMove = (segment: MapSegment): ChessRepertoireMove | null =>
	segment.moves[segment.moves.length - 1] ?? null;

/** One line of a scoresheet: a move number and the two moves under it. */
export interface ScoresheetRow {
	number: number;
	white: ChessRepertoireMove | null;
	black: ChessRepertoireMove | null;
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
