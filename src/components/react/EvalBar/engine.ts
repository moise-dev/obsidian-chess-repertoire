import {
	cancelEvaluation,
	emptyQueue,
	EngineStep,
	Evaluation,
	receiveLine,
	requestEvaluation,
} from 'src/lib/engine';
import { engineSource, engineWasm } from './bundled';

type Listener = (fen: string, evaluation: Evaluation) => void;

/** What a working engine prints: its banner, then UCI. */
const UCI_LINE = /^(Stockfish|id |option |uciok|readyok|info |bestmove)/;

let worker: Worker | null = null;
let urls: string[] = [];
let idleTimer: number | null = null;
let queue = emptyQueue();
const listeners = new Map<string, Listener>();

const apply = (step: EngineStep) => {
	queue = step.queue;
	step.commands.forEach((command) => worker?.postMessage(command));

	if (step.result)
		listeners.get(step.result.client)?.(step.result.fen, step.result.evaluation);
};

/**
 * The loader decides where it is running by looking for Node first, and finding
 * it starts nothing: as a module it only exports a constructor, and waits. A
 * worker in Obsidian can see Node's globals, so the engine sat silent - no
 * banner, no error. Run inside a function whose parameters shadow them, it
 * finds no Node and takes the web worker path, which is the one it is fed for.
 * `onmessage` and `postMessage` are left alone, so they stay the worker's own.
 */
const WORKER_PREAMBLE =
	'(function (global, process, require, module, exports) {\n';
const WORKER_POSTAMBLE = '\n}).call(self);\n';

/**
 * The worker, started on first use rather than with the plugin: a vault with
 * no board open, or with the bar turned off, never pays for it.
 *
 * Both halves come out of main.js as blob URLs. The loader reads the wasm's
 * address from its own URL's fragment and fetches it with a synchronous XHR,
 * which a blob URL answers like any other.
 */
const ensureWorker = (): Worker => {
	if (worker) return worker;

	const wasmUrl = URL.createObjectURL(
		new Blob([engineWasm], { type: 'application/wasm' })
	);
	const scriptUrl = URL.createObjectURL(
		new Blob([WORKER_PREAMBLE, engineSource, WORKER_POSTAMBLE], {
			type: 'text/javascript',
		})
	);

	urls = [wasmUrl, scriptUrl];
	worker = new Worker(`${scriptUrl}#${wasmUrl}`);
	worker.onmessage = (event: MessageEvent) => {
		if (typeof event.data !== 'string') return;

		// Emscripten reports a failed start - a wasm it could not fetch or
		// compile - on the same channel as the engine's output, so anything
		// that is not UCI is said out loud rather than dropped with the rest.
		if (event.data.trim() && !UCI_LINE.test(event.data))
			console.warn('chess-repertoire: the engine said', event.data);

		apply(receiveLine(queue, event.data));
	};
	worker.onerror = (event) => {
		console.error(
			'chess-repertoire: the engine stopped',
			event.message,
			event.filename,
			event.lineno
		);
		stopWorker();
	};

	// Contempt is Stockfish 10's thumb on the scale for the side to move, there
	// to avoid draws in play; it applies to analysis too unless told not to, and
	// read +1.2 for the starting position against +0.7 without it.
	worker.postMessage('uci');
	worker.postMessage('setoption name Contempt value 0');
	worker.postMessage('isready');

	return worker;
};

const stopWorker = () => {
	worker?.terminate();
	worker = null;
	urls.forEach((url) => URL.revokeObjectURL(url));
	urls = [];
	queue = emptyQueue();
};

/**
 * Evaluates `fen` for one board, replacing whatever that board asked for
 * before. Its listener is called once, with the answer.
 */
export const evaluate = (client: string, fen: string, listener: Listener) => {
	if (idleTimer !== null) window.clearTimeout(idleTimer);
	idleTimer = null;
	listeners.set(client, listener);
	ensureWorker();
	apply(requestEvaluation(queue, client, fen));
};

/**
 * How long the engine outlives the last board using it. Long enough to cover
 * going from one note to the next, which unmounts every board and mounts new
 * ones, so that does not cost a restart; short enough that a closed note gives
 * its memory back soon after.
 */
const IDLE_STOP_MS = 30_000;

/**
 * A board is done with the engine. The last one out stops the worker after
 * `IDLE_STOP_MS`, which gives back its memory; the next board to ask starts a
 * fresh one.
 */
export const release = (client: string) => {
	listeners.delete(client);
	apply(cancelEvaluation(queue, client));

	if (listeners.size || idleTimer !== null) return;

	idleTimer = window.setTimeout(() => {
		idleTimer = null;
		if (!listeners.size) stopWorker();
	}, IDLE_STOP_MS);
};

/** For the plugin's unload, which should not leave a worker running behind it. */
export const shutdownEngine = () => {
	if (idleTimer !== null) window.clearTimeout(idleTimer);
	idleTimer = null;
	listeners.clear();
	stopWorker();
};
