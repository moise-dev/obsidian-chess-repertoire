import { Chess, Move } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { App } from 'obsidian';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ColorChoiceModal } from 'src/components/obsidian/ColorChoiceModal';
import { GameActions } from 'src/components/react/ChessStudy';
import { toColor } from 'src/lib/chess-logic';
import {
	findMovePath,
	getContinuations,
	getMoveAtPath,
} from 'src/lib/move-tree';
import { ChessStudyMove } from 'src/lib/storage';
import {
	HintStage,
	TrainerColor,
	buildHintStages,
	errorShapes,
	hintShapes,
} from 'src/lib/trainer';

/** How long the opponent "thinks" before replying, in ms. */
const OPPONENT_DELAY = 450;

export type TrainerStatus =
	| 'idle'
	| 'your-turn'
	| 'opponent'
	| 'wrong'
	| 'complete';

export interface Trainer {
	isActive: boolean;
	playerColor: TrainerColor;
	status: TrainerStatus;
	/** Wrong moves played since the session started. */
	errorCount: number;
	/** The note revealed by the first hint, once it has been asked for. */
	commentHint: string | null;
	/** Hints already given for the move being asked for, and how many exist. */
	hintsGiven: number;
	hintCount: number;
	/** Hint marks and the red arrow of a refused move, for `setAutoShapes`. */
	shapes: DrawShape[];
	/** True while the opponent is to move, or the line has run out. */
	isBoardLocked: boolean;
	start: () => void;
	stop: () => void;
	requestHint: () => void;
	submitMove: (move: Move) => void;
}

interface UseTrainerOptions {
	app: App;
	moves: ChessStudyMove[];
	currentMoveId: string | null;
	/** The position on the board, i.e. whose turn it is. */
	chess: Chess;
	dispatch: React.Dispatch<GameActions>;
	setOrientation: (color: TrainerColor) => void;
}

/**
 * Plays the study back as a drill: you play one colour, the study plays the
 * other, and a move that is not in the study is refused rather than recorded.
 *
 * The session rides on the widget's own navigation state - the move being asked
 * for is simply whatever follows the move on the board - so there is no second
 * copy of "where we are" that could drift out of step with the board.
 */
export const useTrainer = ({
	app,
	moves,
	currentMoveId,
	chess,
	dispatch,
	setOrientation,
}: UseTrainerOptions): Trainer => {
	const [isActive, setIsActive] = useState(false);
	const [playerColor, setPlayerColor] = useState<TrainerColor>('white');
	const [errorCount, setErrorCount] = useState(0);
	const [attempt, setAttempt] = useState<Move | null>(null);
	// -1 is "no hint asked for yet"; the index into the available stages.
	const [hintIndex, setHintIndex] = useState(-1);

	// Every move the study allows from here. The first is the continuation of
	// the line we are on; the rest are variations, which count as correct too -
	// a repertoire is a tree, and drilling it should let you take any branch of
	// it that you actually wrote down.
	const continuations = useMemo(
		() => (isActive ? getContinuations(moves, currentMoveId) : []),
		[currentMoveId, isActive, moves]
	);

	const expected = continuations[0] ?? null;

	const currentMove = useMemo(() => {
		if (!currentMoveId) return null;

		const path = findMovePath(moves, currentMoveId);

		return path ? getMoveAtPath(moves, path) : null;
	}, [currentMoveId, moves]);

	const stages = useMemo(
		() => buildHintStages(expected, currentMove),
		[currentMove, expected]
	);

	const isPlayerTurn = toColor(chess) === playerColor;
	const isComplete = isActive && !expected;

	// Forget the hints and the refused move as soon as the position moves on.
	useEffect(() => {
		setAttempt(null);
		setHintIndex(-1);
	}, [currentMoveId, isActive]);

	// The study plays the other side. Driven by whose turn it is rather than by
	// the move just played, so stepping back through the line with the arrow
	// keys resumes the drill instead of stalling.
	useEffect(() => {
		if (!isActive || isPlayerTurn || !expected) return;

		const timer = window.setTimeout(
			() =>
				dispatch({
					type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
					moveId: expected.moveId,
				}),
			OPPONENT_DELAY
		);

		return () => window.clearTimeout(timer);
	}, [dispatch, expected, isActive, isPlayerTurn]);

	const start = useCallback(() => {
		new ColorChoiceModal(app, {
			body:
				'The drill starts from the position on the board and follows the study. Your opponent plays the moves you wrote down.',
			onChoose: (color) => {
				setPlayerColor(color);
				setOrientation(color);
				setErrorCount(0);
				setAttempt(null);
				setHintIndex(-1);
				setIsActive(true);
			},
		}).open();
	}, [app, setOrientation]);

	const stop = useCallback(() => setIsActive(false), []);

	const requestHint = useCallback(
		() => setHintIndex((index) => Math.min(index + 1, stages.length - 1)),
		[stages.length]
	);

	/**
	 * A move played on the board while a session is running. Anything the study
	 * does not know is bounced: the board goes back to the position before it,
	 * and nothing is written to the study.
	 */
	const submitMove = useCallback(
		(move: Move) => {
			const match = continuations.find(
				(continuation) => continuation.san === move.san
			);

			if (!match) {
				setAttempt(move);
				setErrorCount((count) => count + 1);
				dispatch({ type: 'RESET_BOARD_TO_CURRENT' });

				return;
			}

			dispatch({
				type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
				moveId: match.moveId,
			});
		},
		[continuations, dispatch]
	);

	const revealed: HintStage[] = stages.slice(0, hintIndex + 1);

	const commentStage = revealed.find(
		(stage): stage is Extract<HintStage, { kind: 'comment' }> =>
			stage.kind === 'comment'
	);

	const shapes = useMemo(() => {
		if (!isActive) return [];

		const marks = hintShapes(stages.slice(0, hintIndex + 1));

		return attempt ? [...marks, ...errorShapes(attempt)] : marks;
	}, [attempt, hintIndex, isActive, stages]);

	const status: TrainerStatus = !isActive
		? 'idle'
		: isComplete
		? 'complete'
		: !isPlayerTurn
		? 'opponent'
		: attempt
		? 'wrong'
		: 'your-turn';

	return {
		isActive,
		playerColor,
		status,
		errorCount,
		commentHint: commentStage?.text ?? null,
		hintsGiven: hintIndex + 1,
		hintCount: stages.length,
		shapes,
		isBoardLocked: isActive && (!isPlayerTurn || isComplete),
		start,
		stop,
		requestHint,
		submitMove,
	};
};
