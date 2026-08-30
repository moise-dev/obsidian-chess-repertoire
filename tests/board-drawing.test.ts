/**
 * The board's drawing boundary, exercised against real chessground in a real
 * DOM.
 *
 * Everything else here is pure logic, and none of it could have caught the bug
 * these exist for. Chessground reports drawn shapes by handing over its own
 * `drawable.shapes` array and then goes on mutating it; the state it is handed
 * to freezes whatever it is given. Freezing it meant the next arrow's
 * `shapes.push` threw - inside chessground's `end()`, before the arrow was
 * released - so the arrow followed the pointer around for ever and every shape
 * after the first was lost with the exception.
 *
 * It takes a rendered board and three arrows to see that, hence jsdom.
 */
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

import { closeDom, installDom } from './stubs/dom';

const BOARD_PX = 512;

/**
 * React and chessground both read browser globals when they are first imported,
 * so the document has to exist before either of them does. That is why every
 * import below this point is dynamic.
 */

/** The part of chessground's api these tests look at. */
interface BoardApi {
	state: {
		drawable: { shapes: unknown[]; current: unknown };
		dom: { bounds: () => unknown };
	};
}

interface Board {
	/** Tears the React tree down, so the suite can let go of the document. */
	unmount: () => void;
	/** Chessground's own state, to look at what the component cannot report. */
	state: BoardApi['state'];
	/** Shapes as the app stored them, after the reducer and its freezing. */
	stored: () => unknown[];
	/** True if any `onChange` handed over chessground's live array itself. */
	leakedLiveArray: () => boolean;
	drawArrow: (from: [number, number], to: [number, number]) => Promise<void>;
}

const mountBoard = async (dom: JSDOM): Promise<Board> => {
	const React = await import('react');
	const { createRoot } = await import('react-dom/client');
	const { act } = await import('react-dom/test-utils');
	const { useImmerReducer } = await import('use-immer');
	const { Chess } = await import('chess.js');
	const { ChessgroundWrapper } = await import(
		'../src/components/react/ChessgroundWrapper'
	);

	// Held on an object rather than in a bare `let`: it is only ever assigned
	// from inside the component, which the checker cannot see happen.
	const captured: { api: BoardApi | null } = { api: null };
	let stored: unknown[] = [];
	let leaked = false;
	const chess = new Chess();

	// What ChessRepertoire's SYNC_SHAPES does with them: straight onto the move,
	// which is where immer's freezing comes in.
	const reducer = (draft: { shapes: unknown[] }, shapes: unknown[]) => {
		draft.shapes = shapes;
	};

	const Harness = () => {
		const [state, dispatch] = useImmerReducer(reducer, { shapes: [] });
		const [instance, setInstance] = React.useState<BoardApi | null>(null);

		if (instance && !captured.api) captured.api = instance;

		return React.createElement(
			ChessgroundWrapper as never,
			{
				api: instance,
				setApi: setInstance,
				chess,
				addMoveToHistory: () => undefined,
				syncShapes: (shapes: unknown[]) => {
					if (shapes === captured.api?.state.drawable.shapes) leaked = true;

					stored = shapes;
					dispatch(shapes);
				},
				isViewOnly: false,
				shapes: state.shapes,
			} as never
		);
	};

	const settle = async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
	};

	const root = createRoot(dom.window.document.getElementById('root') as never);

	// `act` wants a promise back even where nothing is awaited inside it.
	await act(() => {
		root.render(React.createElement(Harness));

		return Promise.resolve();
	});
	await settle();

	const api = captured.api;

	assert.ok(api, 'the board should have handed back its api');

	// jsdom does no layout, so the board has to be told how big it is or every
	// pointer position lands outside it and no square is ever hit.
	api.state.dom.bounds = () => ({
		left: 0,
		top: 0,
		right: BOARD_PX,
		bottom: BOARD_PX,
		width: BOARD_PX,
		height: BOARD_PX,
		x: 0,
		y: 0,
	});

	/** Centre of a square, as file and rank indices from a1. */
	const at = (file: number, rank: number) => ({
		clientX: (file + 0.5) * (BOARD_PX / 8),
		clientY: (7 - rank + 0.5) * (BOARD_PX / 8),
	});

	const drawArrow = async (from: [number, number], to: [number, number]) => {
		const board = dom.window.document.querySelector('cg-board');

		assert.ok(board, 'the board should have rendered');

		// Right button down on the board, drag, release: chessground's own
		// gesture for drawing an arrow. Move and release go to the document,
		// which is where it listens for them.
		await act(async () => {
			board.dispatchEvent(
				new dom.window.MouseEvent('mousedown', {
					...at(...from),
					button: 2,
					bubbles: true,
					cancelable: true,
				})
			);
			await new Promise((resolve) => setTimeout(resolve, 25));

			dom.window.document.dispatchEvent(
				new dom.window.MouseEvent('mousemove', { ...at(...to), bubbles: true })
			);
			await new Promise((resolve) => setTimeout(resolve, 25));

			dom.window.document.dispatchEvent(
				new dom.window.MouseEvent('mouseup', {
					...at(...to),
					button: 2,
					bubbles: true,
				})
			);
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	};

	return {
		unmount: () => root.unmount(),
		state: api.state,
		stored: () => stored,
		leakedLiveArray: () => leaked,
		drawArrow,
	};
};

describe('drawing arrows on the board', () => {
	let dom: JSDOM;
	let board: Board;

	before(async () => {
		dom = installDom();
		board = await mountBoard(dom);
	});

	// Chessground needs an animation-frame loop, so the document is a visual
	// one, and React's scheduler holds a message channel open for as long as it
	// is mounted. Both are let go of here; `--test-force-exit` covers whatever
	// either of them leaves behind.
	after(() => {
		board.unmount();
		closeDom(dom);
	});

	it('releases every arrow, not just the first', async () => {
		// a1-a4, then b1-b4, then c1-c4. The second is the one that used to
		// stick: the first is what froze the array it went on to push onto.
		await board.drawArrow([0, 0], [0, 3]);
		assert.equal(
			board.state.drawable.current,
			undefined,
			'the first arrow should have been released'
		);

		await board.drawArrow([1, 0], [1, 3]);
		assert.equal(
			board.state.drawable.current,
			undefined,
			'the second arrow should have been released, not left following the pointer'
		);

		await board.drawArrow([2, 0], [2, 3]);
		assert.equal(
			board.state.drawable.current,
			undefined,
			'the third arrow should have been released'
		);
	});

	it('keeps every arrow that was drawn', () => {
		assert.equal(board.state.drawable.shapes.length, 3);
		assert.equal(board.stored().length, 3);
	});

	it('never hands the reducer chessground’s own array', () => {
		// The whole bug in one assertion: what is stored gets frozen, so it must
		// never be the array chessground is still writing to.
		assert.equal(board.leakedLiveArray(), false);
		assert.equal(Object.isFrozen(board.state.drawable.shapes), false);
	});
});
