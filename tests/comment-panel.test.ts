/**
 * The notes panel, mounted for real so that what it writes back can be watched.
 *
 * It exists for one bug. Tiptap's `setEditable` reports an update whether or not
 * the note changed, and the effect that calls it runs before the note has been
 * loaded in - so mounting the panel on a move that already had a note answered
 * with an empty editor, and that answer was saved over the note. The panel is
 * unmounted for the length of a drill and mounted again afterwards, which is why
 * notes went missing on the way out of one.
 *
 * Nothing but a rendered editor can show this: the panel writes back through a
 * callback that no logic test reaches.
 */
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { closeDom, installDom } from './stubs/dom';

const NOTE_TEXT = 'Play for the d5 break';

/** A saved note, in the shape the repertoire file holds. */
const savedNote = () => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: NOTE_TEXT }] }],
});

/**
 * React and tiptap both read browser globals as they are imported, so the
 * document has to exist first - hence the dynamic imports below.
 */

interface Panel {
	/** Every note the panel has asked to have saved, in order. */
	writes: () => unknown[];
	/** Types into the editor the way a reader would. */
	type: (text: string) => Promise<void>;
	unmount: () => void;
}

const mountPanel = async (
	dom: JSDOM,
	currentComment: unknown
): Promise<Panel> => {
	const React = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { act } = await import('react-dom/test-utils');
	const { CommentSection } = await import(
		'../src/components/react/CommentSection'
	);

	const writes: unknown[] = [];

	const Harness = () =>
		React.createElement(
			CommentSection as never,
			{
				currentComment,
				setComments: (comment: unknown) => writes.push(comment),
				moveLabel: '4... h6',
				defaultOpen: true,
				classification: null,
				onClassify: () => undefined,
			} as never
		);

	const root = createRoot(dom.window.document.getElementById('root') as never);

	await act(() => {
		root.render(React.createElement(Harness));

		return Promise.resolve();
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});

	return {
		writes: () => writes,
		unmount: () => root.unmount(),
		type: async (text: string) => {
			const surface = dom.window.document.querySelector('.ProseMirror');

			assert.ok(surface, 'the editor should have rendered');

			await act(async () => {
				// ProseMirror reads the DOM back after an input event, which is as
				// close to typing as jsdom gets.
				surface.textContent = text;
				surface.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
				await new Promise((resolve) => setTimeout(resolve, 30));
			});
		},
	};
};

describe('the notes panel', () => {
	let dom: JSDOM;

	before(() => {
		dom = installDom();
	});

	after(() => {
		closeDom(dom);
	});

	it('does not save over a note just by being mounted', async () => {
		const panel = await mountPanel(dom, savedNote());

		assert.deepEqual(
			panel.writes(),
			[],
			'mounting the panel is not an edit and must save nothing'
		);

		panel.unmount();
	});

	it('still saves what is actually typed', async () => {
		const panel = await mountPanel(dom, savedNote());

		await panel.type('a different note');

		const written = JSON.stringify(panel.writes());

		assert.ok(
			panel.writes().length > 0,
			'typing into the panel should still be saved'
		);
		assert.ok(
			written.includes('a different note'),
			`the typed text should be what is saved, got ${written}`
		);

		panel.unmount();
	});
});
