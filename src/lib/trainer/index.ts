import { Square } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { commentToPlainText, hasComment } from 'src/lib/comments';
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
