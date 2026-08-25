import { hasComment } from 'src/lib/comments';
import { getReplies } from 'src/lib/move-tree';
import {
	ChessRepertoireDrillData,
	ChessRepertoireFileData,
	ChessRepertoireMove,
	MoveDrillStats,
} from 'src/lib/storage';

export interface MergeResult {
	repertoire: ChessRepertoireFileData;
	/** Repertoires left out because they start from another position. */
	skipped: number;
	/**
	 * Moves that had nowhere to go: an alternative to a repertoire's very first move.
	 * Nothing precedes it, so the tree has no move to hang it off - the same
	 * limitation the PGN importer has.
	 */
	dropped: number;
}

/**
 * Fills in what the first repertoire did not say.
 *
 * A merge should never overwrite: the earlier repertoire is the one being added to,
 * so it keeps whatever it has, and a later one can only supply what is missing.
 */
const fillAnnotations = (
	into: ChessRepertoireMove,
	from: ChessRepertoireMove
): void => {
	if (!hasComment(into.comment) && hasComment(from.comment))
		into.comment = from.comment;

	if (!into.classification && from.classification)
		into.classification = from.classification;

	if (!into.shapes?.length && from.shapes?.length)
		into.shapes = [...from.shapes];

	if (from.excluded && into.excluded === undefined) into.excluded = true;
};

/**
 * Copies a move and everything under it, so the merged repertoire never shares
 * objects with the repertoires it was built from.
 */
const cloneMove = (move: ChessRepertoireMove): ChessRepertoireMove => ({
	...move,
	shapes: [...(move.shapes ?? [])],
	variants: (move.variants ?? []).map((variant) => ({
		...variant,
		moves: variant.moves.map(cloneMove),
	})),
});

/**
 * Grafts `source`'s continuations onto `target`, position by position.
 *
 * `afterMove` is the move both trees are standing on, `null` at the root. At
 * each position the replies are compared by SAN: one the target already has is
 * descended into, and one it lacks is hung off `afterMove` as a new variation -
 * which is where variations live, an alternative to the move that follows.
 */
const graft = (
	target: ChessRepertoireMove[],
	source: ChessRepertoireMove[],
	targetAfter: ChessRepertoireMove | null,
	sourceAfter: ChessRepertoireMove | null,
	result: { dropped: number }
): void => {
	const targetReplies = getReplies(target, targetAfter?.moveId ?? null);

	for (const reply of getReplies(source, sourceAfter?.moveId ?? null)) {
		const existing = targetReplies.find((move) => move.san === reply.san);

		if (existing) {
			fillAnnotations(existing, reply);
			graft(target, source, existing, reply, result);

			continue;
		}

		if (!targetAfter) {
			// An alternative to the first move of the game. Nothing precedes it,
			// so there is no move to hang it off.
			result.dropped += 1;

			continue;
		}

		targetAfter.variants.push({
			variantId: reply.moveId,
			parentMoveId: targetAfter.moveId,
			moves: [reply, ...restOfLine(source, reply)].map(cloneMove),
		});
	}
};

/** The moves after `move` in its own line, which travel with it when grafted. */
const restOfLine = (
	moves: ChessRepertoireMove[],
	move: ChessRepertoireMove
): ChessRepertoireMove[] => {
	const line: ChessRepertoireMove[] = [];

	for (let cursor = move; ; ) {
		const [next] = getReplies(moves, cursor.moveId);

		if (!next) return line;

		line.push(next);
		cursor = next;
	}
};

/** Titles of the repertoires that went in, as one line. */
const mergeTitles = (repertoires: ChessRepertoireFileData[]): string | null => {
	const titles = [
		...new Set(
			repertoires
				.map((repertoire) => repertoire.header?.title?.trim())
				.filter((title): title is string => !!title)
		),
	];

	return titles.length ? titles.join(' + ') : null;
};

/**
 * One repertoire holding every line of the repertoires given, in the order given.
 *
 * The first repertoire is the trunk: its mainline stays the mainline, and everything
 * the others add arrives as variations off it. Only repertoires starting from the
 * same position take part - a repertoire opening from another FEN is a different
 * repertoire, not another view of this one.
 *
 * Move ids are carried across untouched. They are nanoids, so two repertoires
 * cannot collide, and keeping them is what lets a drill history survive the
 * merge.
 */
export const mergeRepertoires = (
	repertoires: ChessRepertoireFileData[],
	version: string
): MergeResult => {
	const [first, ...rest] = repertoires;
	const mergeable = rest.filter(
		(repertoire) => repertoire.rootFEN === first.rootFEN
	);
	const result = { dropped: 0 };

	const moves = first.moves.map(cloneMove);

	for (const repertoire of mergeable)
		graft(moves, repertoire.moves, null, null, result);

	return {
		repertoire: {
			version,
			header: { title: mergeTitles([first, ...mergeable]) },
			moves,
			rootFEN: first.rootFEN,
			playerColor: [first, ...mergeable].find(
				(repertoire) => repertoire.playerColor
			)?.playerColor,
		},
		skipped: rest.length - mergeable.length,
		dropped: result.dropped,
	};
};

/**
 * The drill histories of the merged repertoires, as one.
 *
 * Move ids survive a merge, so the records still name real moves. Attempts and
 * misses add up and the latest sighting wins - the same move drilled in two
 * repertoires was still drilled twice.
 */
export const mergeDrillStats = (
	datas: ChessRepertoireDrillData[]
): Record<string, MoveDrillStats> => {
	const merged: Record<string, MoveDrillStats> = {};

	for (const data of datas)
		for (const [moveId, stats] of Object.entries(data.stats)) {
			const current = merged[moveId];

			if (!current) {
				merged[moveId] = { ...stats };

				continue;
			}

			merged[moveId] = {
				attempts: current.attempts + stats.attempts,
				misses: current.misses + stats.misses,
				lastSeen: Math.max(current.lastSeen, stats.lastSeen),
			};
		}

	return merged;
};
