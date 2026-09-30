/**
 * What a lock refuses.
 *
 * Most of this rule is a type rather than a test: `ALLOWED_WHILE_LOCKED` is a
 * `Record` over every member of `GameActions`, so an action added to the union
 * without a line there fails `tsc` and the build with it. What a type cannot
 * check is whether the lines say the right thing, which is what these do - and
 * in particular that everything which writes to the repertoire sits on the
 * refusing side, since that is the whole promise a lock makes.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isAllowedWhileLocked, shouldSaveShapes } from '../src/lib/lock';

/** Every action that reaches the repertoire's file. */
const WRITES_TO_THE_REPERTOIRE = [
	'ADD_MOVE_TO_HISTORY',
	'REMOVE_LAST_MOVE_FROM_HISTORY',
	'SYNC_SHAPES',
	'SYNC_COMMENT',
	'SET_CLASSIFICATION',
	'SET_TITLE',
	'SET_PLAYER_COLOR',
	'PROMOTE_VARIATION',
	'DELETE_VARIATION',
	'DELETE_FROM_MOVE',
	'SET_EXCLUDED',
	'REORDER_VARIATION',
] as const;

/** Every action that only decides which position is on the board. */
const MOVES_THE_BOARD_ONLY = [
	'DISPLAY_NEXT_MOVE_IN_HISTORY',
	'DISPLAY_PREVIOUS_MOVE_IN_HISTORY',
	'DISPLAY_SELECTED_MOVE_IN_HISTORY',
	'DISPLAY_FIRST_MOVE_IN_HISTORY',
	'DISPLAY_LAST_MOVE_IN_HISTORY',
	'RESET_BOARD_TO_CURRENT',
] as const;

describe('what a locked repertoire allows', () => {
	it('refuses every action that writes to the repertoire', () => {
		for (const action of WRITES_TO_THE_REPERTOIRE)
			assert.equal(
				isAllowedWhileLocked(action),
				false,
				`${action} writes to the repertoire and a lock must refuse it`
			);
	});

	it('allows navigation, which changes nothing', () => {
		for (const action of MOVES_THE_BOARD_ONLY)
			assert.equal(
				isAllowedWhileLocked(action),
				true,
				`${action} only moves the board and should still work when locked`
			);
	});

	it('allows the lock to be taken off again', () => {
		// The one way out. Refusing this would make the first lock permanent.
		assert.equal(isAllowedWhileLocked('SET_LOCKED'), true);
	});

	it('refuses a move played on the board', () => {
		// Read a second time by the reducer as navigation when the repertoire
		// already holds the move, which is how a locked line stays playable -
		// but refused here, because writing a new move down is what it would
		// otherwise do.
		assert.equal(isAllowedWhileLocked('ADD_MOVE_TO_HISTORY'), false);
	});
});

describe('arrows drawn on the board', () => {
	it('are saved while the repertoire is being edited', () => {
		assert.equal(shouldSaveShapes({ isTraining: false, isLocked: false }), true);
	});

	it('are not saved during a drill', () => {
		// An arrow drawn in a session is usually the plan, which is the thing
		// being asked. Writing it back would let a drill edit the repertoire it
		// is testing you on.
		assert.equal(shouldSaveShapes({ isTraining: true, isLocked: false }), false);
	});

	it('are not saved while the repertoire is locked', () => {
		assert.equal(shouldSaveShapes({ isTraining: false, isLocked: true }), false);
	});

	it('are not saved by a drill on a locked repertoire', () => {
		assert.equal(shouldSaveShapes({ isTraining: true, isLocked: true }), false);
	});
});
