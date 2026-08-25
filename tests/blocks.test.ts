import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { findCodeBlocks } from '../src/lib/blocks';

const note = (...lines: string[]) => lines.join('\n');

describe('findCodeBlocks', () => {
	it('finds nothing in a note without any', () => {
		assert.deepEqual(findCodeBlocks('Just some prose.', 'chessStudy'), []);
	});

	it('returns the body of each matching block', () => {
		const content = note(
			'# Italian',
			'```chessStudy',
			'chessStudyId: one',
			'```',
			'Some prose.',
			'```chessStudy',
			'chessStudyId: two',
			'boardSize: 400',
			'```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessStudy'), [
			'chessStudyId: one',
			'chessStudyId: two\nboardSize: 400',
		]);
	});

	it('leaves other languages alone', () => {
		const content = note('```js', 'const chessStudyId = 1;', '```');

		assert.deepEqual(findCodeBlocks(content, 'chessStudy'), []);
	});

	it('reads a nested fence as content rather than as a block', () => {
		const content = note(
			'````markdown',
			'```chessStudy',
			'chessStudyId: example',
			'```',
			'````',
			'```chessStudy',
			'chessStudyId: real',
			'```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessStudy'), [
			'chessStudyId: real',
		]);
	});

	it('ignores a block never closed', () => {
		const content = note('```chessStudy', 'chessStudyId: unfinished');

		assert.deepEqual(findCodeBlocks(content, 'chessStudy'), []);
	});

	it('reads an indented block', () => {
		const content = note(
			'- item',
			'  ```chessStudy',
			'  chessStudyId: one',
			'  ```'
		);

		assert.deepEqual(findCodeBlocks(content, 'chessStudy'), [
			'  chessStudyId: one',
		]);
	});
});
