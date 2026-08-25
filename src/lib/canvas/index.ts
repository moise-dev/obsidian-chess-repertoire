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

/** One line of a card's scoresheet. A move carries its label, where it has one. */
export interface CanvasRow {
	number: number;
	white: string | null;
	black: string | null;
}

/** What a card says, handed over rather than recomputed here. */
export interface CanvasCard {
	segmentId: string;
	/** e.g. `1-10`, the moves the card covers. */
	range: string;
	/** The moves, paired the way a scoresheet pairs them. */
	rows: CanvasRow[];
	/** How the line is holding up, or null where there is nothing to say. */
	state: string | null;
	/** Canvas preset colour for that state. */
	color?: string;
	/** The position the card is about, drawn as a board on the card. */
	fen: string;
	/** Whether that board is turned round, i.e. the study is written for Black. */
	flipped: boolean;
}

/**
 * Canvas cards are read at arm's length rather than zoomed into, so they want
 * more room than the map's own. Positions are scaled from the layout, which is
 * what keeps an exported canvas looking like the diagram it came from.
 */
const SCALE = 1.6;
const CARD_WIDTH = 400;
/** The board block, plus the heading, the state line and the table's own head. */
const FIXED_HEIGHT = 350;
const ROW_HEIGHT = 32;

/**
 * A card sized to what is on it.
 *
 * Not the map's own height scaled: those cards hold a 132px board and a
 * scoresheet in fixed columns, while these hold a board sized to the card and a
 * table. Taking the map's heights left every card mostly empty; guessing at how
 * a run of notation would wrap left some of them scrolling. A table's height is
 * simply its rows.
 */
const cardHeight = (card: CanvasCard | undefined): number =>
	FIXED_HEIGHT + (card?.rows.length ?? 0) * ROW_HEIGHT;

/**
 * The moves as a table.
 *
 * Columns rather than a flowing line, so a card reads down its move numbers the
 * way the map's cards do - and so its height is something that can be known
 * rather than estimated from how the notation happens to wrap.
 */
const scoresheet = (rows: CanvasRow[]): string => {
	if (!rows.length) return '';

	return [
		'| # | White | Black |',
		'| --- | --- | --- |',
		...rows.map(
			(row) => `| ${row.number} | ${row.white ?? ''} | ${row.black ?? ''} |`
		),
	].join('\n');
};

/**
 * The board, as a block this plugin renders.
 *
 * A canvas card is markdown, so the boards arrive by asking the plugin for
 * them. It does mean the boards are drawn only where the plugin is installed -
 * true of the vault the canvas was written into, and the alternatives are
 * worse: a study file per card, or chess glyphs whose font coverage we already
 * know is patchy.
 */
const boardBlock = (card: CanvasCard | undefined): string => {
	if (!card?.fen) return '';

	return [
		'```chessPosition',
		`fen: ${card.fen}`,
		...(card.flipped ? ['orientation: black'] : []),
		'```',
	].join('\n');
};

/**
 * The map as a canvas file.
 *
 * A snapshot, not a second copy of the study: it is a picture of the tree at
 * the moment it was taken, for spreading out and annotating. Nothing reads it
 * back.
 */
export const toCanvas = (
	layout: MapLayout,
	cards: CanvasCard[]
): JsonCanvas => {
	const byId = new Map(cards.map((card) => [card.segmentId, card]));

	const nodes = layout.nodes.map((node): CanvasNode => {
		const card = byId.get(node.segment.id);

		return {
			id: node.segment.id,
			type: 'text',
			text: [
				`**${card?.range ?? ''}**`,
				boardBlock(card),
				scoresheet(card?.rows ?? []),
				card?.state ? `*${card.state}*` : '',
			]
				.filter(Boolean)
				.join('\n\n'),
			x: Math.round(node.x * SCALE),
			y: Math.round(node.y * SCALE),
			width: CARD_WIDTH,
			height: cardHeight(card),
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
