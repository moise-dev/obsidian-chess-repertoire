import { hasComment } from 'src/lib/comments';
import {
	MoveTree,
	ROOT_MOVE_ID,
	findMovePath,
	flattenTree,
	getContinuation,
	getListAtPath,
	getReplies,
	positionKey,
} from 'src/lib/move-tree';
import {
	ChessRepertoireDrillData,
	ChessRepertoireFileData,
	ChessRepertoireMove,
	MoveDrillStats,
	Variant,
} from 'src/lib/storage';

export interface MergeResult {
	repertoire: ChessRepertoireFileData;
	/**
	 * Repertoires left out because the position they open from is nowhere in the
	 * merged tree, so there is no place to join them on.
	 */
	skipped: number;
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
 * descended into, and one it lacks is added.
 *
 * Where it is added depends on whether the target's line goes on from here.
 * Where it does, the new reply is an alternative to what already follows, so it
 * hangs off `afterMove` as a variation - which is where variations live, and at
 * the root that home is the tree's own `rootVariants`. Where the line stops, the
 * first thing grafted on carries it on instead: a repertoire written to continue
 * from this position is the continuation, not an alternative to one, and a note
 * holding an opening in instalments should read as one line rather than as a
 * line that ends and a variation that resumes it. Anything after that first one
 * is an alternative to it, and hangs off `afterMove` as usual.
 */
const graft = (
	target: MoveTree,
	source: MoveTree,
	targetAfter: ChessRepertoireMove | null,
	sourceAfter: ChessRepertoireMove | null
): void => {
	const at = targetAfter?.moveId ?? null;
	const targetReplies = getReplies(target, at);

	// Re-read per graft rather than per reply: only the first addition can take
	// a vacant continuation, and it fills it.
	let carriesOn = !getContinuation(target, at);

	for (const reply of getReplies(source, sourceAfter?.moveId ?? null)) {
		const existing = targetReplies.find((move) => move.san === reply.san);

		if (existing) {
			fillAnnotations(existing, reply);
			graft(target, source, existing, reply);

			continue;
		}

		const line = [reply, ...restOfLine(source, reply)].map(cloneMove);
		const into = carriesOn ? lineOf(target, targetAfter) : null;

		if (into) {
			// `targetAfter` has no continuation, so it is the last move of `into`.
			into.push(...line);
			carriesOn = false;

			continue;
		}

		const home: Variant[] = targetAfter
			? targetAfter.variants
			: target.rootVariants;

		home.push({
			variantId: reply.moveId,
			parentMoveId: targetAfter?.moveId ?? ROOT_MOVE_ID,
			moves: line,
		});
	}
};

/** The run of moves `move` sits in, so a continuation can be added after it. */
const lineOf = (
	tree: MoveTree,
	move: ChessRepertoireMove | null
): ChessRepertoireMove[] | null => {
	if (!move) return tree.moves;

	const path = findMovePath(tree, move.moveId);

	return path ? getListAtPath(tree, path) : null;
};

/** The moves after `move` in its own line, which travel with it when grafted. */
const restOfLine = (
	tree: MoveTree,
	move: ChessRepertoireMove
): ChessRepertoireMove[] => {
	const line: ChessRepertoireMove[] = [];

	for (let cursor = move; ; ) {
		const [next] = getReplies(tree, cursor.moveId);

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
 * Where in `tree` a repertoire opening from `fen` joins on: the move that reaches
 * that position, `null` for the tree's own starting position, or `undefined` if
 * the tree never gets there.
 *
 * By `positionKey` rather than the whole FEN, so a line that arrives by another
 * move order still counts - the clocks would disagree and the position would not.
 * The first move reaching it wins; a position the tree reaches twice is a
 * transposition, and either arrival is the same position to continue from.
 */
const findJoin = (
	tree: MoveTree,
	rootFEN: string,
	fen: string
): ChessRepertoireMove | null | undefined => {
	const key = positionKey(fen);

	if (key === positionKey(rootFEN)) return null;

	return flattenTree(tree).find(
		(move) => move.after && positionKey(move.after) === key
	);
};

/**
 * One repertoire holding every line of the repertoires given.
 *
 * The first repertoire is the trunk: its mainline stays the mainline, and everything
 * the others add arrives as variations off it. A repertoire joins wherever the
 * position it opens from turns up in the trunk - at the start when they share a
 * root, and otherwise at the move that reaches it. That is what lets a note hold
 * an opening in instalments, each one carrying on from where the last left off,
 * and still merge into a single tree.
 *
 * Joining is repeated while anything attaches, so the instalments may be given in
 * any order: one that continues from a position another has not contributed yet
 * simply waits for the pass after it arrives. What is left when nothing more
 * attaches opens from a position the tree never reaches, and is counted as
 * skipped.
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
	const trunk: MoveTree = {
		moves: first.moves.map(cloneMove),
		rootVariants: first.rootVariants.map((variant) => ({
			...variant,
			moves: variant.moves.map(cloneMove),
		})),
	};

	const merged = [first];
	let pending = rest;

	for (let joinedAny = true; joinedAny && pending.length; ) {
		const waiting: ChessRepertoireFileData[] = [];

		joinedAny = false;

		for (const repertoire of pending) {
			const join = findJoin(trunk, first.rootFEN, repertoire.rootFEN);

			if (join === undefined) {
				waiting.push(repertoire);
				continue;
			}

			graft(trunk, repertoire, join, null);
			merged.push(repertoire);
			joinedAny = true;
		}

		pending = waiting;
	}

	return {
		repertoire: {
			version,
			header: { title: mergeTitles(merged) },
			moves: trunk.moves,
			rootVariants: trunk.rootVariants,
			rootFEN: first.rootFEN,
			playerColor: merged.find((repertoire) => repertoire.playerColor)
				?.playerColor,
		},
		skipped: pending.length,
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
