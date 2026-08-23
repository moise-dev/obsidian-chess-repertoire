import { Chess } from 'chess.js';
import { Api as ChessgroundApi } from 'chessground/api';
import { Draft } from 'immer';
import { GameState } from 'src/components/react/ChessStudy';
import { toColor, toDests } from '../chess-logic';
import { ChessStudyMove, VariantMove } from '../storage';

interface MovePosition {
	variant: { parentMoveIndex: number; variantIndex: number } | null;
	moveIndex: number;
}

export const findMoveIndex = (
	moves: ChessStudyMove[],
	moveId: string
): MovePosition => {
	for (const [iMainLine, move] of moves.entries()) {
		if (move.moveId === moveId) return { variant: null, moveIndex: iMainLine };

		for (const [iVariant, variant] of move.variants.entries()) {
			const moveIndex = variant.moves.findIndex((move) => move.moveId === moveId);

			if (moveIndex >= 0)
				return {
					variant: { parentMoveIndex: iMainLine, variantIndex: iVariant },
					moveIndex: moveIndex,
				};
		}
	}

	return { variant: null, moveIndex: -1 };
};

export const displayMoveInHistory = (
	draft: Draft<GameState>,
	chessView: ChessgroundApi,
	setChessLogic: React.Dispatch<React.SetStateAction<Chess>>,
	options: { offset: number; selectedMoveId: string | null } = {
		offset: 0,
		selectedMoveId: null,
	}
): Draft<GameState> => {
	let moveToDisplay: ChessStudyMove | VariantMove | null = null;

	const { offset, selectedMoveId } = options;

	//Figure out where we are
	const currentMove = draft.currentMove;

	if (currentMove) {
		const currentMoveId = currentMove.moveId;

		const moves = draft.study.moves;

		//If we pass a moveId, find out where that is and offset from there, otherwise take current moveId
		const baseMoveId = selectedMoveId || currentMoveId;

		const { variant, moveIndex } = findMoveIndex(moves, baseMoveId);
		//Are we in a variant? Are we not? Decide which move to display

		if (variant) {
			const variantMoves =
				moves[variant.parentMoveIndex].variants[variant.variantIndex].moves;

			if (typeof variantMoves[moveIndex + offset] !== 'undefined') {
				moveToDisplay = variantMoves[moveIndex + offset];
			}

			if (typeof moveToDisplay === 'undefined') {
				moveToDisplay = moves[variant.parentMoveIndex + offset];
			}
		} else {
			if (typeof moves[moveIndex + offset] !== 'undefined') {
				moveToDisplay = moves[moveIndex + offset];
			}
		}
	} else if (offset < 0) {
	  moveToDisplay = draft.study.moves[draft.study.moves.length - 1];
	} else if (offset > 0) {
	  moveToDisplay = draft.study.moves[0];
	}

	if (moveToDisplay) {
		const chess = new Chess(moveToDisplay.after);

		chessView.set({
			fen: moveToDisplay.after,
			check: chess.isCheck(),
			movable: {
				free: false,
				color: toColor(chess),
				dests: toDests(chess),
			},
			turnColor: toColor(chess),
		});

		draft.currentMove = moveToDisplay;

		setChessLogic(chess);
	} else if (offset !== 0){
		const chess = new Chess(draft.study.rootFEN);

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

		draft.currentMove = null;

		setChessLogic(chess);
	} else {
		console.log(`No move to display found`);
		return draft;
	}

	return draft;
};

export const getCurrentMove = (
	draft: Draft<GameState>
): Draft<ChessStudyMove> | Draft<VariantMove> | null => {
	const currentMoveId = draft.currentMove?.moveId;
	const moves = draft.study.moves;

	if (currentMoveId) {
		const { variant, moveIndex } = findMoveIndex(moves, currentMoveId);

		if (variant) {
			return moves[variant.parentMoveIndex].variants[variant.variantIndex].moves[
				moveIndex
			];
		} else {
			return moves[moveIndex];
		}
	}

	return null;
};

/**
 * Jump straight to a position instead of stepping relative to the current one.
 * Passing `null` shows the root position, i.e. before the first move.
 */
export const displayPosition = (
	draft: Draft<GameState>,
	chessView: ChessgroundApi,
	setChessLogic: React.Dispatch<React.SetStateAction<Chess>>,
	move: Draft<ChessStudyMove> | Draft<VariantMove> | null
): Draft<GameState> => {
	const chess = new Chess(move ? move.after : draft.study.rootFEN);

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

	draft.currentMove = move;

	setChessLogic(chess);

	return draft;
};

/**
 * Human-readable label for a move, e.g. `4. c3` or `4... h6`, used as the
 * heading of the notes panel. Variant moves are numbered from their parent.
 */
export const getMoveLabel = (
	moves: ChessStudyMove[],
	moveId: string | null,
	firstPlayer: string,
	initialMoveNumber: number
): string | null => {
	if (!moveId) return null;

	const { variant, moveIndex } = findMoveIndex(moves, moveId);

	if (moveIndex < 0) return null;

	const move = variant
		? moves[variant.parentMoveIndex].variants[variant.variantIndex].moves[
				moveIndex
		  ]
		: moves[moveIndex];

	const mainLineIndex = variant ? variant.parentMoveIndex : moveIndex;
	const offset = firstPlayer === 'b' ? 1 : 0;
	const moveNumber =
		initialMoveNumber + Math.floor((mainLineIndex + offset) / 2);

	return `${moveNumber}${move.color === 'b' ? '...' : '.'} ${move.san}`;
};
