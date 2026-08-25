import { MapLayout } from 'src/lib/move-map';

/**
 * A JSON Canvas file - Obsidian's own canvas format, an open spec.
 *
 * Only the parts a map export needs: text cards and the edges between them.
 * Positions are absolute, which is what lets an exported canvas open looking
 * like the diagram it came from.
 */
export interface CanvasNode {
	id: string;
	type: 'text';
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** One of Canvas's preset colours, "1" through "6". */
	color?: string;
}

export interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: 'right';
	toNode: string;
	toSide: 'left';
}

export interface JsonCanvas {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

/** What a card says, handed over rather than recomputed here. */
export interface CanvasCard {
	segmentId: string;
	/** e.g. `1-10`, the moves the card covers. */
	range: string;
	/** The moves as one line, e.g. `1. e4 e5 2. Nf3 Nc6`. */
	moves: string;
	/** How the line is holding up, or null where there is nothing to say. */
	state: string | null;
	/** Canvas preset colour for that state. */
	color?: string;
}

/**
 * Canvas cards are read at arm's length rather than zoomed into, so they want
 * more room than the map's own. The layout is scaled rather than recomputed, so
 * the export keeps the shape of the diagram it was taken from.
 */
const SCALE = 1.6;
const MIN_HEIGHT = 120;

/**
 * The map as a canvas file.
 *
 * A snapshot, not a second copy of the study: it is a picture of the tree at
 * the moment it was taken, for spreading out and annotating. Nothing reads it
 * back.
 */
export const toCanvas = (
	layout: MapLayout,
	cards: CanvasCard[],
	options: { cardWidth: number }
): JsonCanvas => {
	const byId = new Map(cards.map((card) => [card.segmentId, card]));

	const nodes = layout.nodes.map((node): CanvasNode => {
		const card = byId.get(node.segment.id);

		return {
			id: node.segment.id,
			type: 'text',
			text: [
				`**${card?.range ?? ''}**`,
				card?.moves ?? '',
				card?.state ? `*${card.state}*` : '',
			]
				.filter(Boolean)
				.join('\n\n'),
			x: Math.round(node.x * SCALE),
			y: Math.round(node.y * SCALE),
			width: Math.round(options.cardWidth * SCALE),
			height: Math.max(Math.round(node.height * SCALE), MIN_HEIGHT),
			...(card?.color ? { color: card.color } : {}),
		};
	});

	const edges = layout.edges.map(
		({ from, to }): CanvasEdge => ({
			id: `${from.segment.id}-${to.segment.id}`,
			fromNode: from.segment.id,
			fromSide: 'right',
			toNode: to.segment.id,
			toSide: 'left',
		})
	);

	return { nodes, edges };
};
