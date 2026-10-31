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
 * Whether the reducer runs an action, given what is holding the repertoire.
 *
 * A device that only reads - Obsidian mobile - is a lock that is never
 * written down. It cannot live in the repertoire the way `locked` does: the
 * file syncs, so a phone that locked what it opened would lock it on the
 * desktop too. It also refuses the one action a lock keeps, `SET_LOCKED`,
 * because locking or unlocking from the phone is itself a write.
 */
export const isAllowed = (
	type: GameActions['type'],
	{ isLocked, isReadOnly }: { isLocked: boolean; isReadOnly: boolean }
): boolean => {
	if (isReadOnly) return type !== 'SET_LOCKED' && isAllowedWhileLocked(type);

	return !isLocked || isAllowedWhileLocked(type);
};

/** What the board does with arrows. */
export interface BoardDrawing {
	/** Whether an arrow may be drawn on the board at all. */
	enabled: boolean;
	/** Whether the arrows the board reports are written onto the move. */
	saved: boolean;
}

/**
 * What the board does with arrows, in each state the widget can be in.
 *
 * Editing: drawn and saved. That is what a repertoire's arrows are.
 *
 * Drilling: drawn, never saved. An arrow is how you think about the position
 * you are being asked about, and the session hides the move's own arrows for
 * that same reason - so writing back the ones you drew would mean a drill
 * edited the repertoire that was testing you. Drawing stays on even on a
 * locked repertoire, because a session shows none of its arrows and hands the
 * board back when it ends.
 *
 * Locked, outside a session: neither. Not only a stricter drill, because here
 * the arrows on the board are the real ones, and chessground hangs two things
 * off the single `drawable.enabled` flag: the right-drag that draws an arrow,
 * and the click on an empty square that wipes the board clean. Left on so
 * that scratch arrows were possible, a stray click cleared the arrows the
 * move actually carries. Refusing to save that is not enough - the file was
 * right and the board was lying about it. Off, neither happens.
 */
export const boardDrawing = (state: {
	isTraining: boolean;
	isLocked: boolean;
}): BoardDrawing => ({
	enabled: state.isTraining || !state.isLocked,
	saved: !state.isTraining && !state.isLocked,
});
