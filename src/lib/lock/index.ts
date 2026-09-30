import type { GameActions } from 'src/components/react/ChessRepertoire';

/**
 * Which actions a locked repertoire still runs.
 *
 * A map over every action rather than a list of the ones to refuse. `Record`
 * over the union means an action added to `GameActions` without a line here
 * fails the type check, so the lock cannot be forgotten by an editing action
 * written later, and the answer a new one should reach for is `false`: the
 * lock is a promise about the file, and anything that writes to the file
 * breaks it.
 */
const ALLOWED_WHILE_LOCKED: Record<GameActions['type'], boolean> = {
	// Navigation. None of it touches the tree - it only decides which position
	// is on the board, which is the whole point of a repertoire you can read
	// but not change.
	DISPLAY_NEXT_MOVE_IN_HISTORY: true,
	DISPLAY_PREVIOUS_MOVE_IN_HISTORY: true,
	DISPLAY_SELECTED_MOVE_IN_HISTORY: true,
	DISPLAY_FIRST_MOVE_IN_HISTORY: true,
	DISPLAY_LAST_MOVE_IN_HISTORY: true,
	RESET_BOARD_TO_CURRENT: true,

	// The way back out. Without it a lock could only ever be set.
	SET_LOCKED: true,

	// A move played on the board is refused here and then read a second time as
	// navigation: one the repertoire already holds is a step along a line
	// rather than an edit, so it is followed instead of bounced. Only a move
	// that would have to be written down is turned away. See the reducer.
	ADD_MOVE_TO_HISTORY: false,

	// Everything below writes to the repertoire.
	REMOVE_LAST_MOVE_FROM_HISTORY: false,
	SYNC_SHAPES: false,
	SYNC_COMMENT: false,
	SET_CLASSIFICATION: false,
	SET_TITLE: false,
	SET_PLAYER_COLOR: false,
	PROMOTE_VARIATION: false,
	DELETE_VARIATION: false,
	DELETE_FROM_MOVE: false,
	SET_EXCLUDED: false,
	REORDER_VARIATION: false,
};

export const isAllowedWhileLocked = (type: GameActions['type']): boolean =>
	ALLOWED_WHILE_LOCKED[type];

/**
 * Whether arrows drawn on the board are written back to the move they sit on.
 *
 * Two states say no, for the same reason. A drill draws freely - an arrow is
 * how you think about the position it is asking you about - and saving those
 * would mean a session quietly edited the repertoire it was testing you on. A
 * locked repertoire makes the same bargain deliberately: scratch arrows are
 * fine, writing them down is the thing the lock refuses.
 *
 * Neither is enforced by the board, which goes on drawing either way. What is
 * drawn lives in chessground alone until the position changes and the stored
 * arrows are put back over it.
 */
export const shouldSaveShapes = (state: {
	isTraining: boolean;
	isLocked: boolean;
}): boolean => !state.isTraining && !state.isLocked;
