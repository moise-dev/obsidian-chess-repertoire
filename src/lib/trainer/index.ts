import { Square } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { commentToPlainText, hasComment } from 'src/lib/comments';
import { findMovePath, moveNumberAtPly, plyAtPath } from 'src/lib/move-tree';
import { ChessStudyMove } from 'src/lib/storage';

export type TrainerColor = 'white' | 'black';

/**
 * The three hints, in the order they are handed out: what the study already
 * says about the move, then the piece to touch, then where it goes.
 *
 * A stage the position cannot offer - a move with no note - is left out of the
 * list rather than shown empty, so the first press of the hint button always
 * reveals something.
 */
export type HintStage =
	| { kind: 'comment'; text: string }
	| { kind: 'piece'; from: Square }
	| { kind: 'arrow'; from: Square; to: Square };

/**
 * The note to quote for the move being asked for.
 *
 * The move's own note comes first; failing that, the note on the move just
 * played, which is usually where a line's explanation sits ("... and now Black
 * must stop b5"). Anything else would be about a different position.
 */
const hintComment = (
	expected: ChessStudyMove,
	previous: ChessStudyMove | null
): string | null => {
	const source = [expected.comment, previous?.comment].find(hasComment);

	if (!source) return null;

	const text = commentToPlainText(source, 400);

	return text || null;
};

/** The hints available for `expected`, in the order they are revealed. */
export const buildHintStages = (
	expected: ChessStudyMove | null,
	previous: ChessStudyMove | null
): HintStage[] => {
	if (!expected) return [];

	const comment = hintComment(expected, previous);

	return [
		...(comment ? ([{ kind: 'comment', text: comment }] as HintStage[]) : []),
		{ kind: 'piece', from: expected.from as Square },
		{ kind: 'arrow', from: expected.from as Square, to: expected.to as Square },
	];
};

/** Board decorations for the hints revealed so far. */
export const hintShapes = (stages: HintStage[]): DrawShape[] =>
	stages.flatMap((stage) => {
		switch (stage.kind) {
			case 'piece':
				return [{ orig: stage.from, brush: 'blue' }];
			case 'arrow':
				return [{ orig: stage.from, dest: stage.to, brush: 'blue' }];
			default:
				return [];
		}
	});

/** The refused move, drawn in red so it is clear what was rejected. */
export const errorShapes = (attempt: {
	from: string;
	to: string;
}): DrawShape[] => [
	{ orig: attempt.from as Square, dest: attempt.to as Square, brush: 'red' },
];

/** A move the study refused, and what it wanted instead. */
export interface TrainerMistake {
	/**
	 * The move the drill was standing on. Two lines can reach the same move
	 * number, so the label alone cannot tell one position from another.
	 */
	atMoveId: string | null;
	/** e.g. `4.` or `4...` - where in the line it happened. */
	label: string;
	played: string;
	/** Everything the study would have accepted here, mainline first. */
	expected: string[];
	/** How often the same wrong move was played in the same position. */
	count: number;
}

/** e.g. `4.` or `4...` - which move of the game `move` is. */
export const moveNumberLabel = (
	moves: ChessStudyMove[],
	move: ChessStudyMove,
	firstPlayer: string,
	initialMoveNumber: number
): string => {
	const path = findMovePath(moves, move.moveId);

	if (!path) return '';

	const number = moveNumberAtPly(
		plyAtPath(path),
		firstPlayer,
		initialMoveNumber
	);

	return `${number}${move.color === 'b' ? '...' : '.'}`;
};

/**
 * Adds a refused move to the tally.
 *
 * Playing the same wrong move twice in the same position is one mistake made
 * twice, not two mistakes - the report is about what you do not know, and
 * repeating a line of it says the same thing louder.
 */
export const recordMistake = (
	mistakes: TrainerMistake[],
	mistake: Omit<TrainerMistake, 'count'>
): TrainerMistake[] => {
	const index = mistakes.findIndex(
		(entry) =>
			entry.atMoveId === mistake.atMoveId && entry.played === mistake.played
	);

	if (index < 0) return [...mistakes, { ...mistake, count: 1 }];

	return mistakes.map((entry, position) =>
		position === index ? { ...entry, count: entry.count + 1 } : entry
	);
};
