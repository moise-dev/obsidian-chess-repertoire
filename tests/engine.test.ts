/**
 * The evaluation bar's arithmetic and the queue that shares one engine
 * between boards. The engine itself is not run here: what it prints is fixed
 * by UCI, and these feed that text in by hand.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	cancelEvaluation,
	emptyQueue,
	EngineQueue,
	EVALUATION_DEPTH,
	formatBarLabel,
	formatEvaluation,
	leader,
	parseInfo,
	receiveLine,
	requestEvaluation,
	toEvaluation,
	whiteShare,
} from '../src/lib/engine';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('parseInfo', () => {
	it('reads the depth and a centipawn score', () => {
		assert.deepEqual(
			parseInfo(
				'info depth 12 seldepth 17 multipv 1 score cp 34 nodes 51212 nps 400000 time 128 pv e2e4 e7e5'
			),
			{ depth: 12, score: { kind: 'cp', value: 34 } }
		);
	});

	it('reads a mate score, negative included', () => {
		assert.deepEqual(parseInfo('info depth 5 score mate -2 pv e8f8'), {
			depth: 5,
			score: { kind: 'mate', value: -2 },
		});
	});

	it('passes over bounds, which are about to be searched again', () => {
		assert.equal(parseInfo('info depth 9 score cp 80 lowerbound nodes 1'), null);
		assert.equal(parseInfo('info depth 9 score cp 10 upperbound nodes 1'), null);
	});

	it('passes over lines without a score', () => {
		assert.equal(parseInfo('info depth 12 currmove e2e4 currmovenumber 1'), null);
		assert.equal(parseInfo('bestmove e2e4 ponder e7e5'), null);
		assert.equal(parseInfo('readyok'), null);
	});
});

describe('toEvaluation', () => {
	it('keeps a score from White to move as it is', () => {
		assert.deepEqual(toEvaluation({ kind: 'cp', value: 40 }, START), {
			kind: 'cp',
			cp: 40,
		});
	});

	it('turns a score from Black to move round to White', () => {
		assert.deepEqual(toEvaluation({ kind: 'cp', value: 40 }, AFTER_E4), {
			kind: 'cp',
			cp: -40,
		});
	});

	it('gives a mate to whoever is delivering it', () => {
		assert.deepEqual(toEvaluation({ kind: 'mate', value: 3 }, AFTER_E4), {
			kind: 'mate',
			moves: 3,
			winner: 'b',
		});
		assert.deepEqual(toEvaluation({ kind: 'mate', value: -2 }, AFTER_E4), {
			kind: 'mate',
			moves: 2,
			winner: 'w',
		});
	});

	it('gives mate on the board to the side that is not to move', () => {
		// Fool's mate: White to move and mated.
		const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

		assert.deepEqual(toEvaluation({ kind: 'mate', value: 0 }, mated), {
			kind: 'mate',
			moves: 0,
			winner: 'b',
		});
	});
});

describe('whiteShare', () => {
	it('is half for a level position', () => {
		assert.equal(whiteShare({ kind: 'cp', cp: 0 }), 0.5);
	});

	it('is symmetric, and leans the way the score does', () => {
		const up = whiteShare({ kind: 'cp', cp: 200 });
		const down = whiteShare({ kind: 'cp', cp: -200 });

		assert.ok(up > 0.6 && up < 0.8);
		assert.ok(Math.abs(up + down - 1) < 1e-12);
	});

	it('fills or empties for a mate', () => {
		assert.equal(whiteShare({ kind: 'mate', moves: 4, winner: 'w' }), 1);
		assert.equal(whiteShare({ kind: 'mate', moves: 4, winner: 'b' }), 0);
	});
});

describe('formatEvaluation', () => {
	it('shows pawns to one decimal, signed', () => {
		assert.equal(formatEvaluation({ kind: 'cp', cp: 123 }), '+1.2');
		assert.equal(formatEvaluation({ kind: 'cp', cp: -260 }), '-2.6');
	});

	it('shows a near-zero score as level, without a sign', () => {
		assert.equal(formatEvaluation({ kind: 'cp', cp: 0 }), '0.0');
		assert.equal(formatEvaluation({ kind: 'cp', cp: -4 }), '0.0');
		assert.equal(formatEvaluation({ kind: 'cp', cp: 4 }), '0.0');
	});

	it('shows a mate by its length, and mate on the board as #', () => {
		assert.equal(formatEvaluation({ kind: 'mate', moves: 3, winner: 'b' }), 'M3');
		assert.equal(formatEvaluation({ kind: 'mate', moves: 0, winner: 'w' }), '#');
	});
});

describe('formatBarLabel', () => {
	it('drops the sign, which the end the number sits at already gives', () => {
		assert.equal(formatBarLabel({ kind: 'cp', cp: 390 }), '3.9');
		assert.equal(formatBarLabel({ kind: 'cp', cp: -1050 }), '10.5');
		assert.equal(formatBarLabel({ kind: 'cp', cp: 0 }), '0.0');
		assert.equal(formatBarLabel({ kind: 'mate', moves: 2, winner: 'b' }), 'M2');
	});
});

describe('leader', () => {
	it('is whoever the score favours, White when level', () => {
		assert.equal(leader({ kind: 'cp', cp: -50 }), 'b');
		assert.equal(leader({ kind: 'cp', cp: 0 }), 'w');
		assert.equal(leader({ kind: 'mate', moves: 2, winner: 'b' }), 'b');
	});
});

/** Feeds lines in, collecting what the queue says to send and deliver. */
const feed = (queue: EngineQueue, lines: string[]) => {
	const commands: string[] = [];
	const results: { client: string; fen: string; text: string }[] = [];

	for (const line of lines) {
		const step = receiveLine(queue, line);

		queue = step.queue;
		commands.push(...step.commands);
		if (step.result)
			results.push({
				client: step.result.client,
				fen: step.result.fen,
				text: formatEvaluation(step.result.evaluation),
			});
	}

	return { queue, commands, results };
};

describe('the engine queue', () => {
	it('searches straight away when the engine is free', () => {
		const step = requestEvaluation(emptyQueue(), 'a', START);

		assert.deepEqual(step.commands, [
			`position fen ${START}`,
			`go depth ${EVALUATION_DEPTH}`,
		]);
	});

	it('answers with the last scored line before bestmove', () => {
		const { queue } = requestEvaluation(emptyQueue(), 'a', AFTER_E4);
		const out = feed(queue, [
			'info depth 1 score cp 90 pv e7e5',
			'info depth 12 score cp 30 lowerbound',
			'info depth 12 score cp 30 pv e7e5',
			'bestmove e7e5',
		]);

		assert.deepEqual(out.results, [{ client: 'a', fen: AFTER_E4, text: '-0.3' }]);
		assert.deepEqual(out.queue, emptyQueue());
	});

	it('keeps only the newest position a board asks for while it waits', () => {
		let queue = requestEvaluation(emptyQueue(), 'a', START).queue;

		queue = requestEvaluation(queue, 'b', START).queue;
		queue = requestEvaluation(queue, 'b', AFTER_E4).queue;

		assert.deepEqual(queue.waiting, [{ client: 'b', fen: AFTER_E4 }]);

		const out = feed(queue, ['info depth 12 score cp 20', 'bestmove e2e4']);

		assert.deepEqual(
			out.results.map((result) => result.client),
			['a']
		);
		assert.deepEqual(out.commands, [
			`position fen ${AFTER_E4}`,
			`go depth ${EVALUATION_DEPTH}`,
		]);
	});

	it('cuts short and drops a search its board has moved on from', () => {
		let step = requestEvaluation(emptyQueue(), 'a', START);

		step = requestEvaluation(step.queue, 'a', AFTER_E4);
		assert.deepEqual(step.commands, ['stop']);

		const out = feed(step.queue, [
			'info depth 4 score cp 20',
			'bestmove e2e4',
			'info depth 12 score cp 30',
			'bestmove e7e5',
		]);

		assert.deepEqual(out.results, [{ client: 'a', fen: AFTER_E4, text: '-0.3' }]);
	});

	it('forgets a board that has gone away', () => {
		let queue = requestEvaluation(emptyQueue(), 'a', START).queue;

		queue = requestEvaluation(queue, 'b', AFTER_E4).queue;

		const cancelA = cancelEvaluation(queue, 'a');
		const cancelB = cancelEvaluation(cancelA.queue, 'b');

		assert.deepEqual(cancelA.commands, ['stop']);
		assert.deepEqual(cancelB.queue.waiting, []);

		const out = feed(cancelB.queue, ['info depth 3 score cp 1', 'bestmove e2e4']);

		assert.deepEqual(out.results, []);
		assert.deepEqual(out.queue, emptyQueue());
	});

	it('ignores lines when nothing is being searched', () => {
		const out = feed(emptyQueue(), [
			'readyok',
			'info depth 1 score cp 1',
			'bestmove e2e4',
		]);

		assert.deepEqual(out.results, []);
		assert.deepEqual(out.commands, []);
	});

	it('answers mate on the board, which Stockfish reports at depth 0', () => {
		const mated = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
		const { queue } = requestEvaluation(emptyQueue(), 'a', mated);
		const out = feed(queue, ['info depth 0 score mate 0', 'bestmove (none)']);

		assert.deepEqual(out.results, [{ client: 'a', fen: mated, text: '#' }]);
	});
});
