/**
 * A document for the handful of tests that need a rendered component.
 *
 * Two things have to be dealt with before React is imported, which is why this
 * runs first and everything it serves is imported dynamically afterwards.
 *
 * The document itself, because React and tiptap and chessground all read
 * browser globals as they are imported and there is no document in node.
 *
 * And React's `act`, which opens a `MessageChannel` every time it flushes work
 * and never closes one. The ports outlive the tests and hold the process open,
 * which node's runner reports as the whole file failing - and papering over
 * that with `--test-force-exit` made runs finish early and silently drop tests,
 * reporting a green suite that had not run. So the ports are collected as they
 * are made and closed by {@link closeDom} when a file is done with them.
 */
import { JSDOM } from 'jsdom';

/** Globals the rendered components reach for, copied off the window. */
const BROWSER_GLOBALS = [
	'window',
	'document',
	'navigator',
	'requestAnimationFrame',
	'cancelAnimationFrame',
	'getComputedStyle',
	'Event',
	'MouseEvent',
	'KeyboardEvent',
	'InputEvent',
	'ClipboardEvent',
	'DragEvent',
	'Element',
	'HTMLElement',
	'Node',
	'NodeFilter',
	'Range',
	'DOMParser',
] as const;

interface ClosablePort {
	close?: () => void;
}

const openPorts: ClosablePort[] = [];

/**
 * Keeps a note of every channel opened from here on. Setting `onmessage` on a
 * node port starts it, so unreferencing at construction does not survive what
 * `act` does next; closing them afterwards does.
 */
const collectMessagePorts = (): void => {
	const globals = globalThis as unknown as Record<string, unknown>;
	const Original = globals.MessageChannel as
		| (new () => { port1: ClosablePort; port2: ClosablePort })
		| undefined;

	if (!Original || Original.name === 'CollectedMessageChannel') return;

	globals.MessageChannel = class CollectedMessageChannel extends Original {
		constructor() {
			super();

			openPorts.push(this.port1, this.port2);
		}
	};
};

export const installDom = (): JSDOM => {
	const dom = new JSDOM('<!doctype html><div id="root"></div>', {
		pretendToBeVisual: true,
		url: 'http://localhost',
	});

	const globals = globalThis as unknown as Record<string, unknown>;
	const view = dom.window as unknown as Record<string, unknown>;

	for (const key of BROWSER_GLOBALS) globals[key] = view[key];

	globals.IS_REACT_ACT_ENVIRONMENT = true;

	collectMessagePorts();

	return dom;
};

/**
 * Lets go of the document and of everything `act` left open behind it, so the
 * process can end when the tests do.
 */
export const closeDom = (dom: JSDOM): void => {
	dom.window.close();

	for (const port of openPorts.splice(0)) port.close?.();
};
