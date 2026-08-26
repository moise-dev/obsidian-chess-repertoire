import { Chess, Move } from 'chess.js';
import { DrawShape } from 'chessground/draw';
import { App, Notice } from 'obsidian';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ColorChoiceModal } from 'src/components/obsidian/ColorChoiceModal';
import { GameActions } from 'src/components/react/ChessRepertoire';
import { toColor } from 'src/lib/chess-logic';
import {
	chooseReply,
	getDrillableReplies,
	isDrillable,
	pruneDrillData,
	recordAttempt,
} from 'src/lib/drill';
import {
	MoveTree,
	findMovePath,
	getContinuation,
	getMoveAtPath,
} from 'src/lib/move-tree';
import {
	CURRENT_DRILL_VERSION,
	ChessRepertoireDataAdapter,
	MoveDrillStats,
} from 'src/lib/storage';
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
	/** Where the drill history for this repertoire is read and written. */
	dataAdapter: ChessRepertoireDataAdapter;
	chessRepertoireId: string;
	tree: MoveTree;
	/** The colour the repertoire is written for, if it has said. */
	repertoireColor: 'w' | 'b' | undefined;
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
 * Plays the repertoire back as a drill: you play one colour, the repertoire plays the
 * other, and a move that is not in the repertoire is refused rather than recorded.
 * A session starts from the repertoire's first position and works down from there.
 *
 * The two sides are asked different questions, because a repertoire is not
 * symmetric. Your own move is the one you wrote down, so only the continuation
 * of the line is accepted. The opponent's move is theirs to choose, so every
 * reply the repertoire records is one you undertook to know, and the drill picks
 * among them - favouring the ones you get wrong, and showing lines you have
 * never drilled before anything you have.
 *
 * It keeps no position of its own: what is asked for is decided by the move on
 * the board, so there is nothing that can fall out of step with it.
 */
export const useTrainer = ({
	app,
	dataAdapter,
	chessRepertoireId,
	tree,
	repertoireColor,
	currentMoveId,
	chess,
	firstPlayer,
	initialMoveNumber,
	dispatch,
	setOrientation,
}: UseTrainerOptions): Trainer => {
	const [isActive, setIsActive] = useState(false);
	const [playerColor, setPlayerColor] = useState<TrainerColor>(
		repertoireColor === 'b' ? 'black' : 'white'
	);
	const [attempt, setAttempt] = useState<Move | null>(null);
	const [mistakes, setMistakes] = useState<TrainerMistake[]>([]);
	const [movesPlayed, setMovesPlayed] = useState(0);
	const [report, setReport] = useState<TrainerReport | null>(null);
	// -1 means no hint asked for yet; otherwise an index into `stages`.
	const [hintIndex, setHintIndex] = useState(-1);
	// A ref rather than state: nothing renders the history, the reply is drawn
	// from it inside a timeout where a stale closure would read the wrong
	// counts, and it is written on every answer.
	const statsRef = useRef<Record<string, MoveDrillStats>>({});
	// Which reply the repertoire settled on at each position, keyed by the move the
	// board was standing on. Within a session a position always gets the same
	// answer, so stepping back with the arrow keys reviews the line you played
	// instead of rerouting it; the next session draws afresh.
	const repliesRef = useRef<Record<string, string>>({});

	/** The colour whose moves the history is about: the one being drilled. */
	const userColor = playerColor === 'white' ? 'w' : 'b';

	// The one move the repertoire accepts from you here. Variations at this position
	// are alternatives you could have chosen and did not, so they are not other
	// answers to the same question.
	const expected = useMemo(() => {
		const next = getContinuation(tree, currentMoveId);

		return next && isDrillable(next) ? next : null;
	}, [currentMoveId, tree]);

	// What the repertoire may play against you here. Excluded branches are left out,
	// so a line kept for reference is never played into.
	const replies = useMemo(
		() => getDrillableReplies(tree, currentMoveId),
		[currentMoveId, tree]
	);

	const currentMove = useMemo(() => {
		if (!currentMoveId) return null;

		const path = findMovePath(tree, currentMoveId);

		return path ? getMoveAtPath(tree, path) : null;
	}, [currentMoveId, tree]);

	const stages = useMemo(
		() => buildHintStages(expected, currentMove),
		[currentMove, expected]
	);

	const isPlayerTurn = toColor(chess) === playerColor;
	// A drill ends where the repertoire stops answering: no continuation for you, or
	// nothing left for the repertoire to reply with.
	const isComplete = isActive && (isPlayerTurn ? !expected : !replies.length);

	// Forget the hints and the refused move as soon as the position moves on.
	useEffect(() => {
		setAttempt(null);
		setHintIndex(-1);
	}, [currentMoveId, isActive]);

	// The repertoire plays the other side. Driven by whose turn it is rather than by
	// the move just played, so stepping back through the line with the arrow
	// keys resumes the drill instead of stalling.
	useEffect(() => {
		if (!isActive || isPlayerTurn || !replies.length) return;

		const timer = window.setTimeout(() => {
			const key = currentMoveId ?? '';
			const settled = replies.find(
				(reply) => reply.moveId === repliesRef.current[key]
			);
			// Drawn here rather than in a memo, which would roll again on every
			// render and change the reply while it was being waited for.
			const reply =
				settled ?? chooseReply(tree, currentMoveId, statsRef.current, userColor);

			if (!reply) return;

			repliesRef.current[key] = reply.moveId;

			dispatch({
				type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
				moveId: reply.moveId,
			});
		}, OPPONENT_DELAY);

		return () => window.clearTimeout(timer);
	}, [
		currentMoveId,
		dispatch,
		isActive,
		isPlayerTurn,
		tree,
		replies,
		userColor,
	]);

	const start = useCallback(() => {
		if (!tree.moves.length) {
			new Notice('This repertoire has no moves to train yet.');
			return;
		}

		// Excluding the repertoire's first move takes the whole thing out of drills.
		// Saying so beats starting a session that ends on its own move.
		if (!getDrillableReplies(tree, null).length) {
			new Notice('Every line in this repertoire is excluded from drills.');
			return;
		}

		const beginSession = async (color: TrainerColor) => {
			setPlayerColor(color);

			// A repertoire that has not said which side it is written for learns it
			// here, since answering this question is saying so.
			const chosen = color === 'black' ? 'b' : 'w';

			if (chosen !== repertoireColor)
				dispatch({ type: 'SET_PLAYER_COLOR', color: chosen });

			setOrientation(color);
			setReport(null);
			setMistakes([]);
			setMovesPlayed(0);
			setAttempt(null);
			setHintIndex(-1);

			// Read per session rather than on mount: a note can hold several
			// repertoires and most of them are never drilled. Pruned on the way in,
			// so a repertoire edited for years does not carry records for lines it no
			// longer has.
			statsRef.current = pruneDrillData(
				await dataAdapter.loadDrillData(chessRepertoireId),
				tree
			).stats;
			repliesRef.current = {};

			// Rewind to the repertoire's own starting position - the standard array
			// for an ordinary game, or whatever FEN the repertoire opens from - so a
			// session always drills from the top, wherever the board happened to
			// be sitting when the button was pressed.
			dispatch({ type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' });

			setIsActive(true);
		};

		new ColorChoiceModal(app, {
			body:
				'The drill runs the repertoire from its first move. Your opponent picks from the replies you wrote down, so no two sessions need take the same line.',
			current:
				repertoireColor === 'b'
					? 'black'
					: repertoireColor === 'w'
					? 'white'
					: undefined,
			// The modal wants a handler that returns nothing, and reading the drill
			// history is a round trip to disk, so the session starts on its own.
			onChoose: (color) => void beginSession(color),
		}).open();
	}, [
		app,
		chessRepertoireId,
		dataAdapter,
		dispatch,
		tree,
		setOrientation,
		repertoireColor,
	]);

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

			// A session stopped part way still answered real questions, so its
			// history is kept too. Failing to write it costs the history and
			// nothing else, so it is logged rather than announced.
			void dataAdapter
				.saveDrillData(chessRepertoireId, {
					version: CURRENT_DRILL_VERSION,
					stats: statsRef.current,
				})
				.catch((e) =>
					console.error('chess-repertoire: could not save the drill history', e)
				);
		},
		[chessRepertoireId, dataAdapter, mistakes, movesPlayed, playerColor]
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
	 * A move played on the board while a session is running. Anything the repertoire
	 * does not know is bounced: the board goes back to the position before it,
	 * and nothing is written to the repertoire.
	 */
	const submitMove = useCallback(
		(move: Move) => {
			if (!expected || expected.san !== move.san) {
				if (expected)
					statsRef.current = recordAttempt(statsRef.current, expected.moveId, true);

				setAttempt(move);
				setMistakes((tally) =>
					recordMistake(tally, {
						atMoveId: currentMoveId,
						label: expected
							? moveNumberLabel(tree, expected, firstPlayer, initialMoveNumber)
							: '',
						played: move.san,
						expected: expected?.san ?? '',
					})
				);
				dispatch({ type: 'RESET_BOARD_TO_CURRENT' });

				return;
			}

			// A move found only after a hint is not a move you knew, so it counts
			// against the line rather than for it - which is what brings the line
			// back round sooner.
			statsRef.current = recordAttempt(
				statsRef.current,
				expected.moveId,
				hintIndex >= 0
			);

			setMovesPlayed((count) => count + 1);

			dispatch({
				type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
				moveId: expected.moveId,
			});
		},
		[
			currentMoveId,
			dispatch,
			expected,
			firstPlayer,
			hintIndex,
			initialMoveNumber,
			tree,
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
