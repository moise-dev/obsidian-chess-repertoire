import { Square } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { commentToPlainText, hasComment } from 'src/lib/comments';
import {
	MoveTree,
	findMovePath,
	moveNumberAtPly,
	plyAtPath,
} from 'src/lib/move-tree';
import { ChessRepertoireMove } from 'src/lib/storage';

export type TrainerColor = 'white' | 'black';

/**
 * The three hints, in the order they are handed out: what the repertoire already
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
	expected: ChessRepertoireMove,
	previous: ChessRepertoireMove | null
): string | null => {
	const source = [expected.comment, previous?.comment].find(hasComment);

	if (!source) return null;

	const text = commentToPlainText(source, 400);

	return text || null;
};

/** The hints available for `expected`, in the order they are revealed. */
export const buildHintStages = (
	expected: ChessRepertoireMove | null,
	previous: ChessRepertoireMove | null
): HintStage[] => {
	if (!expected) return [];

	const comment = hintComment(expected, previous);

	return [
		...(comment ? ([{ kind: 'comment', text: comment }] as HintStage[]) : []),
		{ kind: 'piece', from: expected.from },
		{ kind: 'arrow', from: expected.from, to: expected.to },
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

/** A move the repertoire refused, and what it wanted instead. */
export interface TrainerMistake {
	/**
	 * The move the drill was standing on. Two lines can reach the same move
	 * number, so the label alone cannot tell one position from another.
	 */
	atMoveId: string | null;
	/** e.g. `4.` or `4...` - where in the line it happened. */
	label: string;
	played: string;
	/** The move the repertoire wanted, or empty at the end of a line. */
	expected: string;
	/** How often the same wrong move was played in the same position. */
	count: number;
}

/** e.g. `4.` or `4...` - which move of the game `move` is. */
export const moveNumberLabel = (
	tree: MoveTree,
	move: ChessRepertoireMove,
	firstPlayer: string,
	initialMoveNumber: number
): string => {
	const path = findMovePath(tree, move.moveId);

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

/** What the bar says at a position holding more than one of your own moves. */
export interface BranchCue {
	/** Every move you prepared here, in the order the move list shows them. */
	options: string[];
	/** The one this session settled on, which is also in `options`. */
	expected: string;
}

/**
 * The branch to announce before the move is asked for, or null where there is
 * nothing to choose between.
 *
 * A position can hold several moves of your own - two prepared replies to the
 * same position - and the drill has to settle on one of them. Nothing on the
 * board says which, so every branch but the chosen one would be refused as a
 * mistake for no reason the board can show. Naming it gives away one move and
 * leaves the line under it to be remembered, which is the part worth drilling.
 */
export const buildBranchCue = (
	replies: ChessRepertoireMove[],
	expected: ChessRepertoireMove | null
): BranchCue | null =>
	expected && replies.length > 1
		? { options: replies.map((reply) => reply.san), expected: expected.san }
		: null;
