import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { findCodeBlocks } from '../src/lib/blocks';

const note = (...lines: string[]) => lines.join('\n');

describe('findCodeBlocks', () => {
	it('finds nothing in a note without any', () => {
		assert.deepEqual(findCodeBlocks('Just some prose.', 'chessRepertoire'), []);
	});

	it('returns the body of each matching block', () => {
		const content = note(
			'# Italian',
			'```chessRepertoire',
			'chessRepertoireId: one',
			'```',
			'Some prose.',
			'```chessRepertoire',
			'chessRepertoireId: two',
			'boardSize: 400',
			'```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessRepertoire'), [
			'chessRepertoireId: one',
			'chessRepertoireId: two\nboardSize: 400',
		]);
	});

	it('leaves other languages alone', () => {
		const content = note('```js', 'const chessRepertoireId = 1;', '```');

		assert.deepEqual(findCodeBlocks(content, 'chessRepertoire'), []);
	});

	it('reads a nested fence as content rather than as a block', () => {
		const content = note(
			'````markdown',
			'```chessRepertoire',
			'chessRepertoireId: example',
			'```',
			'````',
			'```chessRepertoire',
			'chessRepertoireId: real',
			'```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessRepertoire'), [
			'chessRepertoireId: real',
		]);
	});

	it('ignores a block never closed', () => {
		const content = note('```chessRepertoire', 'chessRepertoireId: unfinished');

		assert.deepEqual(findCodeBlocks(content, 'chessRepertoire'), []);
	});

	it('reads an indented block', () => {
		const content = note(
			'- item',
			'  ```chessRepertoire',
			'  chessRepertoireId: one',
			'  ```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessRepertoire'), [
			'  chessRepertoireId: one',
		]);
	});
});
