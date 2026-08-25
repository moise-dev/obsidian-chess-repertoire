import { hasComment } from 'src/lib/comments';
import { getReplies } from 'src/lib/move-tree';
import {
	ChessStudyDrillData,
	ChessStudyFileData,
	ChessStudyMove,
	MoveDrillStats,
} from 'src/lib/storage';

export interface MergeResult {
	study: ChessStudyFileData;
	/** Studies left out because they start from another position. */
	skipped: number;
	/**
	 * Moves that had nowhere to go: an alternative to a study's very first move.
	 * Nothing precedes it, so the tree has no move to hang it off - the same
	 * limitation the PGN importer has.
	 */
	dropped: number;
}

/**
 * Fills in what the first study did not say.
 *
 * A merge should never overwrite: the earlier study is the one being added to,
 * so it keeps whatever it has, and a later one can only supply what is missing.
 */
const fillAnnotations = (into: ChessStudyMove, from: ChessStudyMove): void => {
	if (!hasComment(into.comment) && hasComment(from.comment))
		into.comment = from.comment;

	if (!into.classification && from.classification)
		into.classification = from.classification;

	if (!into.shapes?.length && from.shapes?.length)
		into.shapes = [...from.shapes];

	if (from.excluded && into.excluded === undefined) into.excluded = true;
};

/**
 * Copies a move and everything under it, so the merged study never shares
 * objects with the studies it was built from.
 */
const cloneMove = (move: ChessStudyMove): ChessStudyMove => ({
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
	target: ChessStudyMove[],
	source: ChessStudyMove[],
	targetAfter: ChessStudyMove | null,
	sourceAfter: ChessStudyMove | null,
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
	moves: ChessStudyMove[],
	move: ChessStudyMove
): ChessStudyMove[] => {
	const line: ChessStudyMove[] = [];

	for (let cursor = move; ; ) {
		const [next] = getReplies(moves, cursor.moveId);

		if (!next) return line;

		line.push(next);
		cursor = next;
	}
};

/** Titles of the studies that went in, as one line. */
const mergeTitles = (studies: ChessStudyFileData[]): string | null => {
	const titles = [
		...new Set(
			studies
				.map((study) => study.header?.title?.trim())
				.filter((title): title is string => !!title)
		),
	];

	return titles.length ? titles.join(' + ') : null;
};

/**
 * One study holding every line of the studies given, in the order given.
 *
 * The first study is the trunk: its mainline stays the mainline, and everything
 * the others add arrives as variations off it. Only studies starting from the
 * same position take part - a study opening from another FEN is a different
 * study, not another view of this one.
 *
 * Move ids are carried across untouched. They are nanoids, so two studies
 * cannot collide, and keeping them is what lets a drill history survive the
 * merge.
 */
export const mergeStudies = (
	studies: ChessStudyFileData[],
	version: string
): MergeResult => {
	const [first, ...rest] = studies;
	const mergeable = rest.filter((study) => study.rootFEN === first.rootFEN);
	const result = { dropped: 0 };

	const moves = first.moves.map(cloneMove);

	for (const study of mergeable) graft(moves, study.moves, null, null, result);

	return {
		study: {
			version,
			header: { title: mergeTitles([first, ...mergeable]) },
			moves,
			rootFEN: first.rootFEN,
			playerColor: [first, ...mergeable].find((study) => study.playerColor)
				?.playerColor,
		},
		skipped: rest.length - mergeable.length,
		dropped: result.dropped,
	};
};

/**
 * The drill histories of the merged studies, as one.
 *
 * Move ids survive a merge, so the records still name real moves. Attempts and
 * misses add up and the latest sighting wins - the same move drilled in two
 * studies was still drilled twice.
 */
export const mergeDrillStats = (
	datas: ChessStudyDrillData[]
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
