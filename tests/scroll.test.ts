import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { scrollOffsetToShow } from '../src/lib/scroll';

/** A box 100 tall, sitting 50 down the screen. */
const list = { top: 50, bottom: 150 };

describe('scrollOffsetToShow', () => {
	it('leaves a move that is already in view alone', () => {
		assert.equal(scrollOffsetToShow({ top: 60, bottom: 80 }, list), 0);
	});

	it('leaves a move flush with either edge alone', () => {
		assert.equal(scrollOffsetToShow({ top: 50, bottom: 70 }, list), 0);
		assert.equal(scrollOffsetToShow({ top: 130, bottom: 150 }, list), 0);
	});

	it('scrolls up by just enough for a move above the top', () => {
		assert.equal(scrollOffsetToShow({ top: 30, bottom: 45 }, list), -20);
	});

	it('scrolls down by just enough for a move below the bottom', () => {
		assert.equal(scrollOffsetToShow({ top: 160, bottom: 180 }, list), 30);
	});

	it('shows the start of a move too tall to fit', () => {
		// Scrolling to its bottom would put its first line out of reach, and the
		// move being looked for is at the top of it.
		assert.equal(scrollOffsetToShow({ top: 20, bottom: 300 }, list), -30);
	});

	it('does not move a move that spans the whole box', () => {
		assert.equal(scrollOffsetToShow({ top: 50, bottom: 150 }, list), 0);
	});
});
