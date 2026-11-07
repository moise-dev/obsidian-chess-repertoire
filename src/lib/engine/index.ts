/**
 * How far the engine looks. Twelve half-moves is a fraction of a second even
 * for the asm-era Stockfish shipped here, and the bar is for "about two pawns
 * down", not for the second decimal: a deeper search moves the number, rarely
 * the verdict.
 */
export const EVALUATION_DEPTH = 12;

/** Always from White's side, so the bar never has to know whose move it is. */
export type Evaluation =
	| { kind: 'cp'; cp: number }
	/** `moves` is 0 when the position on the board is already mate. */
	| { kind: 'mate'; moves: number; winner: 'w' | 'b' };

/** A scored `info` line, still from the side to move, as UCI gives it. */
export interface EngineInfo {
	depth: number;
	score: { kind: 'cp' | 'mate'; value: number };
}

const INFO_SCORE = /^info\b.*?\bdepth (\d+)\b.*?\bscore (cp|mate) (-?\d+)/;

/**
 * The score in an `info` line, or null for one that carries none.
 *
 * A bound is a search that failed high or low and is about to be redone, so
 * its number is a limit rather than an answer and is passed over.
 */
export const parseInfo = (line: string): EngineInfo | null => {
	if (/\b(lowerbound|upperbound)\b/.test(line)) return null;

	const match = INFO_SCORE.exec(line);

	if (!match) return null;

	return {
		depth: Number(match[1]),
		score: { kind: match[2] as 'cp' | 'mate', value: Number(match[3]) },
	};
};

/** The side to move, from the FEN's second field. */
const sideToMove = (fen: string): 'w' | 'b' =>
	fen.split(/\s+/)[1] === 'b' ? 'b' : 'w';

/**
 * A UCI score turned round to White's side.
 *
 * `mate 0` is the one that cannot be signed: it means the side to move is
 * already mated, which is why a mate carries its winner rather than a sign.
 */
export const toEvaluation = (
	score: EngineInfo['score'],
	fen: string
): Evaluation => {
	const mover = sideToMove(fen);
	const other = mover === 'w' ? 'b' : 'w';

	if (score.kind === 'mate')
		return {
			kind: 'mate',
			moves: Math.abs(score.value),
			winner: score.value > 0 ? mover : other,
		};

	return { kind: 'cp', cp: mover === 'w' ? score.value : -score.value };
};

/**
 * How much of the bar is White's, from 0 to 1.
 *
 * Lichess's winning-chances curve rather than a straight clamp: a pawn up in
 * a level position moves the bar visibly, while ten pawns and twelve look the
 * same, which is how they play.
 */
export const whiteShare = (evaluation: Evaluation): number => {
	if (evaluation.kind === 'mate') return evaluation.winner === 'w' ? 1 : 0;

	return 1 / (1 + Math.exp(-0.00368208 * evaluation.cp));
};

/** The number on the bar: `+1.2`, `-0.4`, `0.0`, `M3`, or `#` for mate on the board. */
export const formatEvaluation = (evaluation: Evaluation): string => {
	if (evaluation.kind === 'mate')
		return evaluation.moves === 0 ? '#' : `M${evaluation.moves}`;

	const pawns = evaluation.cp / 100;

	// Rounded before the sign is chosen, so -0.04 reads as 0.0 and not -0.0.
	const rounded = Math.round(pawns * 10) / 10;

	if (rounded === 0) return '0.0';

	return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
};

/**
 * The number printed on the bar itself: `formatEvaluation` without its sign.
 * The bar is narrow, and the number sits at the end of whoever is ahead, which
 * already says what the sign would.
 */
export const formatBarLabel = (evaluation: Evaluation): string =>
	formatEvaluation(evaluation).replace(/^[+-]/, '');

/** Which end of the bar is ahead, for where its number sits. */
export const leader = (evaluation: Evaluation): 'w' | 'b' =>
	evaluation.kind === 'mate' ? evaluation.winner : evaluation.cp < 0 ? 'b' : 'w';

/*
 * One engine is shared by every board on the screen: each is a worker holding
 * 64MB, and a note can hold several boards. It answers one search at a time,
 * so the boards queue, and a board asking again before its turn replaces its
 * own place in the queue rather than adding to it - stepping through ten
 * moves quickly costs one search, not ten.
 */

export interface EngineQueue {
	searching: {
		client: string;
		fen: string;
		/** Asked for by a board that has since moved on or gone away. */
		stale: boolean;
		last: EngineInfo | null;
	} | null;
	waiting: { client: string; fen: string }[];
}

export interface EngineStep {
	queue: EngineQueue;
	/** UCI commands to send, in order. */
	commands: string[];
	/** A finished search, for the board that asked for it. */
	result?: { client: string; fen: string; evaluation: Evaluation };
}

export const emptyQueue = (): EngineQueue => ({ searching: null, waiting: [] });

const start = (
	queue: EngineQueue,
	client: string,
	fen: string
): EngineStep => ({
	queue: {
		...queue,
		searching: { client, fen, stale: false, last: null },
	},
	commands: [`position fen ${fen}`, `go depth ${EVALUATION_DEPTH}`],
});

/** A board wants this position evaluated. */
export const requestEvaluation = (
	queue: EngineQueue,
	client: string,
	fen: string
): EngineStep => {
	if (!queue.searching) return start(queue, client, fen);

	const waiting = [
		...queue.waiting.filter((entry) => entry.client !== client),
		{ client, fen },
	];

	if (queue.searching.client !== client)
		return { queue: { ...queue, waiting }, commands: [] };

	// Its own previous position is still being searched: that answer is no
	// longer wanted, so it is marked to be dropped and the search cut short.
	return {
		queue: { searching: { ...queue.searching, stale: true }, waiting },
		commands: ['stop'],
	};
};

/** A board has gone away, or no longer shows a bar. */
export const cancelEvaluation = (
	queue: EngineQueue,
	client: string
): EngineStep => {
	const waiting = queue.waiting.filter((entry) => entry.client !== client);

	if (queue.searching?.client !== client)
		return { queue: { ...queue, waiting }, commands: [] };

	return {
		queue: { searching: { ...queue.searching, stale: true }, waiting },
		commands: ['stop'],
	};
};

/** A line from the engine. */
export const receiveLine = (queue: EngineQueue, line: string): EngineStep => {
	const { searching } = queue;

	if (!searching) return { queue, commands: [] };

	const info = parseInfo(line);

	if (info)
		return {
			queue: { ...queue, searching: { ...searching, last: info } },
			commands: [],
		};

	if (!line.startsWith('bestmove')) return { queue, commands: [] };

	const [next, ...rest] = queue.waiting;
	const step = next
		? start({ searching: null, waiting: rest }, next.client, next.fen)
		: { queue: emptyQueue(), commands: [] };

	if (searching.stale || !searching.last) return step;

	return {
		...step,
		result: {
			client: searching.client,
			fen: searching.fen,
			evaluation: toEvaluation(searching.last.score, searching.fen),
		},
	};
};
