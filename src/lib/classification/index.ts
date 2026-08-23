/**
 * chess.com-style move classifications, set by hand.
 *
 * Everything about a label - what it is called, how it is drawn, which key sets
 * it - lives in this one table, so adding chess.com's `Book` or `Miss` later is
 * a single row.
 */

export type MoveClassification =
	| 'brilliant'
	| 'great'
	| 'excellent'
	| 'good'
	| 'inaccuracy'
	| 'mistake'
	| 'blunder';

interface ClassificationMeta {
	label: string;
	glyph: string;
	color: string;
	/** Digit that applies this label when the widget has focus. */
	shortcut: string;
	/**
	 * Numeric Annotation Glyph, for a future PGN export. Not all of chess.com's
	 * tiers have a standard NAG - those are null.
	 */
	nag: number | null;
}

export const CLASSIFICATIONS: Record<MoveClassification, ClassificationMeta> = {
	brilliant: {
		label: 'Brilliant',
		glyph: '!!',
		color: '#26c2a3',
		shortcut: '1',
		nag: 3,
	},
	great: {
		label: 'Great',
		glyph: '!',
		color: '#5c8bb0',
		shortcut: '2',
		nag: 1,
	},
	excellent: {
		label: 'Excellent',
		glyph: '★',
		color: '#96bc4b',
		shortcut: '3',
		nag: null,
	},
	good: {
		label: 'Good',
		glyph: '✓',
		color: '#96af8b',
		shortcut: '4',
		nag: null,
	},
	inaccuracy: {
		label: 'Inaccuracy',
		glyph: '?!',
		color: '#f7c631',
		shortcut: '5',
		nag: 6,
	},
	mistake: {
		label: 'Mistake',
		glyph: '?',
		color: '#ffa459',
		shortcut: '6',
		nag: 2,
	},
	blunder: {
		label: 'Blunder',
		glyph: '??',
		color: '#fa412d',
		shortcut: '7',
		nag: 4,
	},
};

export const CLASSIFICATION_ORDER = Object.keys(
	CLASSIFICATIONS
) as MoveClassification[];

const BY_SHORTCUT = new Map(
	CLASSIFICATION_ORDER.map((key) => [CLASSIFICATIONS[key].shortcut, key])
);

/** `1`-`7` pick a label; `0` clears one. Anything else is not a shortcut. */
export const classificationForKey = (
	key: string
): { classification: MoveClassification | null } | null => {
	if (key === '0') return { classification: null };

	const classification = BY_SHORTCUT.get(key);

	return classification ? { classification } : null;
};

const isClassification = (value: unknown): value is MoveClassification =>
	typeof value === 'string' && value in CLASSIFICATIONS;

/** Guards against a hand-edited or future-version study file. */
export const readClassification = (
	value: unknown
): MoveClassification | null => (isClassification(value) ? value : null);

/**
 * Badge drawn on the destination square of a classified move.
 *
 * Chessground hands custom SVGs a 100x100 coordinate system anchored at the
 * top-left of the square. The badge is kept fully inside that box rather than
 * overhanging the corner as chess.com's does: the board wrapper clips its
 * overflow to keep its rounded corners, so an overhanging badge is sliced in
 * half on the h-file and the 8th rank.
 */
export const classificationBadgeSvg = (
	classification: MoveClassification
): string => {
	const { glyph, color } = CLASSIFICATIONS[classification];

	// Two-character glyphs need to be set smaller to stay inside the circle.
	const fontSize = glyph.length > 1 ? 26 : 32;

	return `
		<circle cx="76" cy="24" r="21" fill="${color}" stroke="#ffffff" stroke-width="4" />
		<text x="76" y="24" fill="#ffffff" font-size="${fontSize}" font-weight="700"
		      font-family="Inter, system-ui, sans-serif"
		      text-anchor="middle" dominant-baseline="central">${glyph}</text>
	`;
};
