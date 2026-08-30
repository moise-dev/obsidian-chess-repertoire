import {
	MoveTree,
	collectSubtree,
	flattenTree,
	getReplies,
} from 'src/lib/move-tree';
import {
	ChessRepertoireDrillData,
	ChessRepertoireMove,
	MoveDrillStats,
} from 'src/lib/storage';

/**
 * How often a line the user always gets right still comes up, relative to one
 * they always get wrong. Weighted picking rather than always taking the worst
 * branch: otherwise a single stubborn line eats every session and the rest of
 * the repertoire is never seen again.
 */
const FAMILIAR_WEIGHT = 0.15;

/**
 * How much a branch's share of the repertoire's undrilled moves counts towards
 * asking it, against the miss rate of what has been drilled there.
 *
 * Without it the weight is a rate and nothing else, which is deliberately
 * scale-free and therefore blind to how much of a branch has never been seen:
 * measured over a deep repertoire, picking replies came out no better than a
 * coin flip, and most of the tree was never reached at all. Sampling a branch
 * in proportion to the unlearned material under it is what cancels that, since
 * a move twenty plies down is behind twenty choices and is otherwise reached
 * exponentially less often than one near the root.
 */
const COVERAGE_WEIGHT = 1;

/**
 * The side a repertoire is drilled for.
 *
 * The repertoire's own answer when it has one; otherwise the way the board is
 * turned, since a repertoire is kept the way round it is played. One helper
 * rather than two, so the map and the drill can never disagree about it.
 */
export const resolveRepertoireColor = (
	playerColor: 'w' | 'b' | undefined,
	orientation: 'white' | 'black'
): 'w' | 'b' => playerColor ?? (orientation === 'black' ? 'b' : 'w');

/** Whether a move takes part in drills at all. */
export const isDrillable = (move: ChessRepertoireMove): boolean =>
	!move.excluded;

/**
 * The replies the repertoire is willing to play at a position.
 *
 * Excluding a move keeps it in the repertoire but out of rehearsal, and since a
 * drill can only reach the rest of a line by playing into its first move,
 * dropping it here is enough to leave the whole branch alone.
 */
export const getDrillableReplies = (
	tree: MoveTree,
	moveId: string | null
): ChessRepertoireMove[] => getReplies(tree, moveId).filter(isDrillable);

/**
 * Every move a drill can never reach, by id: the ones carrying the flag and
 * everything only reachable through them.
 *
 * For the move list rather than for the drill. A session walks down from the
 * root and refuses to enter an excluded move, so it never has to ask about
 * ancestors - but the list draws the whole tree at once, and greying only the
 * flagged move would suggest the line under it still gets rehearsed.
 *
 * A variation counts as reachable through the move it hangs off, since that is
 * the move that has to be played to be offered it.
 */
const collectExcludedInLine = (
	moves: ChessRepertoireMove[],
	inherited: boolean,
	found: Set<string>
): void => {
	let excluded = inherited;

	for (const move of moves) {
		excluded = excluded || !isDrillable(move);

		if (excluded) found.add(move.moveId);

		for (const variant of move.variants ?? [])
			collectExcludedInLine(variant.moves, excluded, found);
	}
};

export const collectExcludedMoveIds = (tree: MoveTree): Set<string> => {
	const found = new Set<string>();

	// Each top-level line starts clean: a root alternative branches from the
	// start, so nothing on the mainline can have excluded it.
	collectExcludedInLine(tree.moves, false, found);

	for (const variant of tree.rootVariants)
		collectExcludedInLine(variant.moves, false, found);

	return found;
};

/** Lifetime attempts and misses over the user's own moves under `move`. */
export interface DrillRecord {
	attempts: number;
	misses: number;
	/** The user's own moves under here that have never been asked for at all. */
	undrilled: number;
}

/**
 * What the drills know about the line starting at `move`.
 *
 * Only the user's own moves count: the repertoire's replies are never answered, so
 * they carry no record of their own. A branch is judged by how well the user
 * plays *underneath* it, which is what makes it possible to weigh a reply the
 * user never has to find.
 */
export const subtreeRecord = (
	tree: MoveTree,
	move: ChessRepertoireMove,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b'
): DrillRecord =>
	collectSubtree(tree, move.moveId)
		.filter((entry) => entry.color === userColor && isDrillable(entry))
		.reduce(
			(record, entry) => {
				const entryStats = stats[entry.moveId];

				if (!entryStats) return { ...record, undrilled: record.undrilled + 1 };

				return {
					...record,
					attempts: record.attempts + entryStats.attempts,
					misses: record.misses + entryStats.misses,
				};
			},
			{ attempts: 0, misses: 0, undrilled: 0 }
		);

export interface WeightedReply {
	move: ChessRepertoireMove;
	/** Never drilled, so nothing is yet known about it. */
	unseen: boolean;
	weight: number;
}

/**
 * The drillable replies at a position, each with how badly it wants asking.
 *
 * The rate is lifetime rather than recent: two counters cannot express a
 * decaying average without losing the honest totals the map will want for
 * colouring nodes. `lastSeen` is recorded against every move so a scheduler can
 * do recency properly later.
 */
export const weighReplies = (
	tree: MoveTree,
	moveId: string | null,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b'
): WeightedReply[] => {
	const records = getDrillableReplies(tree, moveId).map((move) => ({
		move,
		record: subtreeRecord(tree, move, stats, userColor),
	}));

	// Shares rather than counts, so the coverage term stays comparable to a miss
	// rate however big the repertoire is, and falls away to nothing once every
	// line here has been drilled at least once.
	const undrilledHere = records.reduce(
		(sum, { record }) => sum + record.undrilled,
		0
	);

	return records.map(({ move, record }) => {
		const { attempts, misses, undrilled } = record;
		const coverage = undrilledHere
			? COVERAGE_WEIGHT * (undrilled / undrilledHere)
			: 0;

		return {
			move,
			unseen: attempts === 0,
			weight:
				attempts === 0 ? 1 + coverage : FAMILIAR_WEIGHT + misses / attempts + coverage,
		};
	});
};

/**
 * Which reply the repertoire plays at a position, or null where the line ends.
 *
 * Anything never drilled goes first, uniformly: a repertoire is only prepared
 * once every line has been seen at least once, so covering the tree comes ahead
 * of grinding the parts already met. After that it is a weighted draw, so the
 * lines the user keeps missing come up most without the rest going cold.
 *
 * `random` is injected so a session can be made repeatable in tests.
 */
export const chooseReply = (
	tree: MoveTree,
	moveId: string | null,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b',
	random: () => number = Math.random
): ChessRepertoireMove | null => {
	const replies = weighReplies(tree, moveId, stats, userColor);

	if (!replies.length) return null;

	const unseen = replies.filter((reply) => reply.unseen);
	const pool = unseen.length ? unseen : replies;
	const total = pool.reduce((sum, reply) => sum + reply.weight, 0);

	let ticket = random() * total;

	for (const reply of pool) {
		ticket -= reply.weight;

		if (ticket < 0) return reply.move;
	}

	// Only reachable if `random` returns 1, or floating point rounds the sum
	// down. Falling back to the last candidate keeps a drill from stalling.
	return pool[pool.length - 1].move;
};

/**
 * Folds one answer into the history. Every attempt counts, right or wrong: the
 * weight is a rate, so it needs the successes as much as the misses.
 */
export const recordAttempt = (
	stats: Record<string, MoveDrillStats>,
	moveId: string,
	missed: boolean,
	now: number = Date.now()
): Record<string, MoveDrillStats> => {
	const current = stats[moveId] ?? { attempts: 0, misses: 0, lastSeen: 0 };

	return {
		...stats,
		[moveId]: {
			attempts: current.attempts + 1,
			misses: current.misses + (missed ? 1 : 0),
			lastSeen: now,
		},
	};
};

/**
 * Drops records for moves the repertoire no longer has.
 *
 * Deleting a move leaves its history behind, and a `moveId` is never reused, so
 * the orphan is harmless - but a repertoire edited for years would carry every line
 * it ever had. Pruning on load keeps the file the size of the repertoire.
 */
export const pruneDrillData = (
	data: ChessRepertoireDrillData,
	tree: MoveTree
): ChessRepertoireDrillData => {
	const live = new Set(flattenTree(tree).map((move) => move.moveId));

	const stats = Object.fromEntries(
		Object.entries(data.stats).filter(([moveId]) => live.has(moveId))
	);

	return { ...data, stats };
};
