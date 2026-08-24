import { Chess } from 'chess.js';
import { Api as ChessgroundApi } from 'chessground/api';
import { Draft } from 'immer';
import { GameState } from 'src/components/react/ChessStudy';
import { toColor, toDests } from '../chess-logic';
import {
	MovePath,
	findMovePath,
	getListAtPath,
	getMoveAtPath,
	getParentMovePath,
	moveNumberAtPly,
	plyAtPath,
} from '../move-tree';
import { ChessStudyMove } from '../storage';

export const findMovePathById = (
	moves: ChessStudyMove[],
	moveId: string
): MovePath | null => findMovePath(moves, moveId);

/** Puts a position on the board and syncs the chess.js logic to match. */
const showPosition = (
	chessView: ChessgroundApi,
	setChessLogic: React.Dispatch<React.SetStateAction<Chess>>,
	fen: string
): Chess => {
	const chess = new Chess(fen);

	chessView.set({
		fen: chess.fen(),
		check: chess.isCheck(),
		movable: {
			free: false,
			color: toColor(chess),
			dests: toDests(chess),
		},
		turnColor: toColor(chess),
	});

	setChessLogic(chess);

	return chess;
};

/**
 * Steps `offset` moves from the current position, or jumps to `selectedMoveId`.
 *
 * Stepping back off the start of a variation lands on the move it hangs off,
 * which is what makes a nested line navigable with the arrow keys alone.
 */
export const displayMoveInHistory = (
	draft: Draft<GameState>,
	chessView: ChessgroundApi,
	setChessLogic: React.Dispatch<React.SetStateAction<Chess>>,
	options: { offset: number; selectedMoveId: string | null } = {
		offset: 0,
		selectedMoveId: null,
	}
): Draft<GameState> => {
	const { offset, selectedMoveId } = options;
	const moves = draft.study.moves;

	let moveToDisplay: Draft<ChessStudyMove> | null = null;

	const baseMoveId = selectedMoveId || draft.currentMove?.moveId;

	if (baseMoveId) {
		const path = findMovePath(moves, baseMoveId);

		if (path) {
			const list = getListAtPath(moves, path);
			const index = path[path.length - 1];
			const target = list?.[index + offset];

			if (target) {
				moveToDisplay = target as Draft<ChessStudyMove>;
			} else if (offset < 0) {
				// Off the front of a variation: fall back to its parent move. On the
				// mainline there is no parent, so this leaves the root position.
				const parentPath = getParentMovePath(path);

				moveToDisplay = parentPath
					? (getMoveAtPath(moves, parentPath) as Draft<ChessStudyMove>)
					: null;
			} else {
				// Off the end of a line: stay put rather than jumping somewhere
				// unrelated.
				return draft;
			}
		}
	} else if (offset > 0) {
		moveToDisplay = (moves[0] as Draft<ChessStudyMove>) ?? null;
	} else if (offset < 0) {
		return draft;
	}

	if (moveToDisplay) {
		showPosition(chessView, setChessLogic, moveToDisplay.after);
		draft.currentMove = moveToDisplay;
	} else if (offset !== 0) {
		showPosition(chessView, setChessLogic, draft.study.rootFEN);
		draft.currentMove = null;
	} else {
		return draft;
	}

	return draft;
};

/**
 * Jump straight to a position instead of stepping relative to the current one.
 * Passing `null` shows the root position, i.e. before the first move.
 */
export const displayPosition = (
	draft: Draft<GameState>,
	chessView: ChessgroundApi,
	setChessLogic: React.Dispatch<React.SetStateAction<Chess>>,
	move: Draft<ChessStudyMove> | null
): Draft<GameState> => {
	showPosition(chessView, setChessLogic, move ? move.after : draft.study.rootFEN);

	draft.currentMove = move;

	return draft;
};

export const getCurrentMove = (
	draft: Draft<GameState>
): Draft<ChessStudyMove> | null => {
	const currentMoveId = draft.currentMove?.moveId;

	if (!currentMoveId) return null;

	const path = findMovePath(draft.study.moves, currentMoveId);

	return path
		? (getMoveAtPath(draft.study.moves, path) as Draft<ChessStudyMove>)
		: null;
};

/**
 * Human-readable label for a move, e.g. `4. c3` or `4... h6`, used as the
 * heading of the notes panel.
 */
export const getMoveLabel = (
	moves: ChessStudyMove[],
	moveId: string | null,
	firstPlayer: string,
	initialMoveNumber: number
): string | null => {
	if (!moveId) return null;

	const path = findMovePath(moves, moveId);
	const move = path && getMoveAtPath(moves, path);

	if (!move || !path) return null;

	const moveNumber = moveNumberAtPly(
		plyAtPath(path),
		firstPlayer,
		initialMoveNumber
	);

	return `${moveNumber}${move.color === 'b' ? '...' : '.'} ${move.san}`;
};
