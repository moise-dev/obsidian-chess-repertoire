import { collectSubtree, flattenMoves, getReplies } from 'src/lib/move-tree';
import {
	ChessStudyDrillData,
	ChessStudyMove,
	MoveDrillStats,
} from 'src/lib/storage';

/**
 * How often a line the user always gets right still comes up, relative to one
 * they always get wrong. Weighted picking rather than always taking the worst
 * branch: otherwise a single stubborn line eats every session and the rest of
 * the repertoire is never seen again.
 */
const FAMILIAR_WEIGHT = 0.15;

/** Whether a move takes part in drills at all. */
export const isDrillable = (move: ChessStudyMove): boolean => !move.excluded;

/**
 * The replies the study is willing to play at a position.
 *
 * Excluding a move keeps it in the study but out of rehearsal, and since a
 * drill can only reach the rest of a line by playing into its first move,
 * dropping it here is enough to leave the whole branch alone.
 */
export const getDrillableReplies = (
	moves: ChessStudyMove[],
	moveId: string | null
): ChessStudyMove[] => getReplies(moves, moveId).filter(isDrillable);

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
export const collectExcludedMoveIds = (
	moves: ChessStudyMove[],
	inherited = false,
	found: Set<string> = new Set()
): Set<string> => {
	let excluded = inherited;

	for (const move of moves) {
		excluded = excluded || !isDrillable(move);

		if (excluded) found.add(move.moveId);

		for (const variant of move.variants ?? [])
			collectExcludedMoveIds(variant.moves, excluded, found);
	}

	return found;
};

/** Lifetime attempts and misses over the user's own moves under `move`. */
export interface DrillRecord {
	attempts: number;
	misses: number;
}

/**
 * What the drills know about the line starting at `move`.
 *
 * Only the user's own moves count: the study's replies are never answered, so
 * they carry no record of their own. A branch is judged by how well the user
 * plays *underneath* it, which is what makes it possible to weigh a reply the
 * user never has to find.
 */
export const subtreeRecord = (
	moves: ChessStudyMove[],
	move: ChessStudyMove,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b'
): DrillRecord =>
	collectSubtree(moves, move.moveId)
		.filter((entry) => entry.color === userColor && isDrillable(entry))
		.reduce(
			(record, entry) => {
				const entryStats = stats[entry.moveId];

				if (!entryStats) return record;

				return {
					attempts: record.attempts + entryStats.attempts,
					misses: record.misses + entryStats.misses,
				};
			},
			{ attempts: 0, misses: 0 }
		);

export interface WeightedReply {
	move: ChessStudyMove;
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
	moves: ChessStudyMove[],
	moveId: string | null,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b'
): WeightedReply[] =>
	getDrillableReplies(moves, moveId).map((move) => {
		const { attempts, misses } = subtreeRecord(moves, move, stats, userColor);

		return {
			move,
			unseen: attempts === 0,
			weight: attempts === 0 ? 1 : FAMILIAR_WEIGHT + misses / attempts,
		};
	});

/**
 * Which reply the study plays at a position, or null where the line ends.
 *
 * Anything never drilled goes first, uniformly: a repertoire is only prepared
 * once every line has been seen at least once, so covering the tree comes ahead
 * of grinding the parts already met. After that it is a weighted draw, so the
 * lines the user keeps missing come up most without the rest going cold.
 *
 * `random` is injected so a session can be made repeatable in tests.
 */
export const chooseReply = (
	moves: ChessStudyMove[],
	moveId: string | null,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b',
	random: () => number = Math.random
): ChessStudyMove | null => {
	const replies = weighReplies(moves, moveId, stats, userColor);

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
 * Drops records for moves the study no longer has.
 *
 * Deleting a move leaves its history behind, and a `moveId` is never reused, so
 * the orphan is harmless - but a study edited for years would carry every line
 * it ever had. Pruning on load keeps the file the size of the study.
 */
export const pruneDrillData = (
	data: ChessStudyDrillData,
	moves: ChessStudyMove[]
): ChessStudyDrillData => {
	const live = new Set(flattenMoves(moves).map((move) => move.moveId));

	const stats = Object.fromEntries(
		Object.entries(data.stats).filter(([moveId]) => live.has(moveId))
	);

	return { ...data, stats };
};
