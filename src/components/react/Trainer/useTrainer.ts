import { Chess, Move } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { App, Notice } from 'obsidian';
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
	TrainerMistake,
	buildHintStages,
	errorShapes,
	hintShapes,
	moveNumberLabel,
	recordMistake,
} from 'src/lib/trainer';

/** How long the opponent "thinks" before replying, in ms. */
const OPPONENT_DELAY = 450;

export type TrainerStatus =
	| 'idle'
	| 'your-turn'
	| 'opponent'
	| 'wrong'
	| 'complete';

/** What a finished session had to say, shown once the drill is over. */
export interface TrainerReport {
	playerColor: TrainerColor;
	/** The line was played to its end, rather than stopped part way. */
	completed: boolean;
	/** Correct moves played, the drill's own moves only. */
	movesPlayed: number;
	mistakes: TrainerMistake[];
}

export interface Trainer {
	isActive: boolean;
	/** The last session's report, until it is dismissed. */
	report: TrainerReport | null;
	dismissReport: () => void;
	playerColor: TrainerColor;
	status: TrainerStatus;
	/** Wrong moves played since the session started, repeats included. */
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
	/** Numbering context, so a mistake can say which move it was. */
	firstPlayer: string;
	initialMoveNumber: number;
	dispatch: React.Dispatch<GameActions>;
	setOrientation: (color: TrainerColor) => void;
}

/**
 * Plays the study back as a drill: you play one colour, the study plays the
 * other, and a move that is not in the study is refused rather than recorded.
 * A session starts from the study's first position and follows the line from
 * there.
 *
 * It rides on the widget's own navigation state - the move being asked for is
 * simply whatever follows the move on the board - so there is no second copy of
 * "where we are" that could drift out of step with the board.
 */
export const useTrainer = ({
	app,
	moves,
	currentMoveId,
	chess,
	firstPlayer,
	initialMoveNumber,
	dispatch,
	setOrientation,
}: UseTrainerOptions): Trainer => {
	const [isActive, setIsActive] = useState(false);
	const [playerColor, setPlayerColor] = useState<TrainerColor>('white');
	const [attempt, setAttempt] = useState<Move | null>(null);
	const [mistakes, setMistakes] = useState<TrainerMistake[]>([]);
	const [movesPlayed, setMovesPlayed] = useState(0);
	const [report, setReport] = useState<TrainerReport | null>(null);
	// -1 is "no hint asked for yet"; the index into the available stages.
	const [hintIndex, setHintIndex] = useState(-1);

	// Every move the study allows from here. The first is the continuation of
	// the line we are on; the rest are variations, which count as correct too -
	// a repertoire is a tree, and drilling it should let you take any branch of
	// it that you actually wrote down.
	const continuations = useMemo(
		() => getContinuations(moves, currentMoveId),
		[currentMoveId, moves]
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
		if (!moves.length) {
			new Notice('This study has no moves to train yet.');
			return;
		}

		new ColorChoiceModal(app, {
			body:
				'The drill runs the study from its first move. Your opponent plays the moves you wrote down.',
			onChoose: (color) => {
				setPlayerColor(color);
				setOrientation(color);
				setReport(null);
				setMistakes([]);
				setMovesPlayed(0);
				setAttempt(null);
				setHintIndex(-1);

				// Rewind to the study's own starting position - the standard array
				// for an ordinary game, or whatever FEN the study opens from - so a
				// session always drills the line from the top, wherever the board
				// happened to be sitting when the button was pressed.
				dispatch({ type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' });

				setIsActive(true);
			},
		}).open();
	}, [app, dispatch, moves.length, setOrientation]);

	/**
	 * Ends the session and leaves its report behind. Stopping part way still
	 * reports: the mistakes made up to that point are the reason to stop.
	 */
	const endSession = useCallback(
		(completed: boolean) => {
			setIsActive(false);
			setReport(
				completed || mistakes.length
					? { playerColor, completed, movesPlayed, mistakes }
					: null
			);
		},
		[mistakes, movesPlayed, playerColor]
	);

	const stop = useCallback(() => endSession(false), [endSession]);

	const dismissReport = useCallback(() => setReport(null), []);

	// The line has run out: the drill is over, so hand back the board and say
	// how it went.
	useEffect(() => {
		if (isActive && isComplete) endSession(true);
	}, [endSession, isActive, isComplete]);

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
				setMistakes((tally) =>
					recordMistake(tally, {
						atMoveId: currentMoveId,
						label: expected
							? moveNumberLabel(moves, expected, firstPlayer, initialMoveNumber)
							: '',
						played: move.san,
						expected: continuations.map((continuation) => continuation.san),
					})
				);
				dispatch({ type: 'RESET_BOARD_TO_CURRENT' });

				return;
			}

			setMovesPlayed((count) => count + 1);

			dispatch({
				type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
				moveId: match.moveId,
			});
		},
		[
			continuations,
			currentMoveId,
			dispatch,
			expected,
			firstPlayer,
			initialMoveNumber,
			moves,
		]
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
		report,
		dismissReport,
		playerColor,
		status,
		errorCount: mistakes.reduce((total, mistake) => total + mistake.count, 0),
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
