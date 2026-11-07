/**
 * Which way round a repertoire's board starts. The widget is rebuilt every time
 * its note is opened, so this is the whole of what decides the orientation
 * someone sees when they come back to a note - a black repertoire that came
 * back turned for white was the bug.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { initialOrientation, orientationFor } from '../src/lib/orientation';

describe('initialOrientation', () => {
	it('turns the board for the side the repertoire is written for', () => {
		assert.equal(
			initialOrientation({
				blockOrientation: undefined,
				playerColor: 'b',
				defaultOrientation: 'white',
			}),
			'black'
		);
		assert.equal(
			initialOrientation({
				blockOrientation: undefined,
				playerColor: 'w',
				defaultOrientation: 'black',
			}),
			'white'
		);
	});

	it('lets a boardOrientation written in the block win', () => {
		assert.equal(
			initialOrientation({
				blockOrientation: 'white',
				playerColor: 'b',
				defaultOrientation: 'white',
			}),
			'white'
		);
	});

	it('falls back to the default when the repertoire has not said', () => {
		assert.equal(
			initialOrientation({
				blockOrientation: undefined,
				playerColor: undefined,
				defaultOrientation: 'black',
			}),
			'black'
		);
	});

	it('ignores a block value that is not an orientation', () => {
		assert.equal(
			initialOrientation({
				blockOrientation: 'Black',
				playerColor: 'b',
				defaultOrientation: 'white',
			}),
			'black'
		);
		assert.equal(
			initialOrientation({
				blockOrientation: true,
				playerColor: undefined,
				defaultOrientation: 'white',
			}),
			'white'
		);
	});
});

describe('orientationFor', () => {
	it('maps a side to the way round it is played from', () => {
		assert.equal(orientationFor('w'), 'white');
		assert.equal(orientationFor('b'), 'black');
	});
});
