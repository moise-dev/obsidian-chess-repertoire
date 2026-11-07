/**
 * The Stockfish loader as it is shipped. Obsidian's plugin review fails a
 * release whose main.js creates script elements, and the loader's bundled
 * setImmediate polyfill does, in a branch a worker never reaches; the build
 * cuts it out. These check that the cut is clean and that it is the only
 * thing that changed.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';
import { patchStockfishLoader, REMOVALS } from '../stockfish-patch.mjs';

const original = readFileSync(
	'node_modules/stockfish/src/stockfish.js',
	'utf8'
);
const patched = patchStockfishLoader(original);

describe('the shipped Stockfish loader', () => {
	it('creates no script elements', () => {
		assert.ok(original.includes('createElement("script")'));
		assert.ok(!/createElement\(\s*["'`]script["'`]\s*\)/i.test(patched));
	});

	it('still compiles', () => {
		assert.doesNotThrow(() => new Script(patched));
	});

	it('keeps the fallback a worker actually takes', () => {
		assert.ok(patched.includes('installMessageChannelImplementation()}else{'));
	});

	it('removes nothing but the readystatechange fallback', () => {
		const removed = REMOVALS.reduce((sum, text) => sum + text.length, 0);

		assert.equal(original.length - patched.length, removed);
		assert.ok(!patched.includes('installReadyStateChangeImplementation'));
	});

	it('refuses a loader it does not recognise rather than guessing', () => {
		assert.throws(() => patchStockfishLoader('var x = 1;'), /stockfish-patch/);
	});
});
