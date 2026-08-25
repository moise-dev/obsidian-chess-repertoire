import { ChessStudyMove } from 'src/lib/storage';

/** How deep variations may nest. The mainline is depth 0. */
export const MAX_VARIATION_DEPTH = 4;

/**
 * Address of a move in the tree.
 *
 * `[i]` is mainline move `i`. Descending into a variation appends the variation
 * index and the move index within it, so `[i, v, j]` is move `j` of variation
 * `v` hanging off mainline move `i`, and `[i, v, j, w, k]` is one level deeper.
 * Length is always odd: `1 + 2 * depth`.
 */
export type MovePath = number[];

export const pathDepth = (path: MovePath): number => (path.length - 1) / 2;

/**
 * Half-move number of the move at `path`, counting from 0 at the first mainline
 * move. A variation hanging off a move at ply `p` starts at ply `p + 1`, so this
 * stays correct however deep the nesting goes.
 */
export const plyAtPath = (path: MovePath): number => {
	let ply = path[0] ?? 0;

	for (let i = 2; i < path.length; i += 2) ply += 1 + path[i];

	return ply;
};

/** The array of moves that directly contains the move at `path`. */
export const getListAtPath = <T extends ChessStudyMove>(
	moves: T[],
	path: MovePath
): T[] | null => {
	let list = moves;

	for (let i = 0; i + 2 < path.length; i += 2) {
		const variant = list[path[i]]?.variants?.[path[i + 1]];

		if (!variant) return null;

		list = variant.moves as T[];
	}

	return list;
};

export const getMoveAtPath = <T extends ChessStudyMove>(
	moves: T[],
	path: MovePath
): T | null => {
	if (!path.length) return null;

	const list = getListAtPath(moves, path);

	return list?.[path[path.length - 1]] ?? null;
};

/** Path of the move a variation hangs off, or null when at the mainline. */
export const getParentMovePath = (path: MovePath): MovePath | null =>
	path.length > 1 ? path.slice(0, -2) : null;

export const findMovePath = (
	moves: ChessStudyMove[],
	moveId: string,
	prefix: MovePath = []
): MovePath | null => {
	for (const [moveIndex, move] of moves.entries()) {
		const path = [...prefix, moveIndex];

		if (move.moveId === moveId) return path;

		for (const [variantIndex, variant] of (move.variants ?? []).entries()) {
			const found = findMovePath(variant.moves, moveId, [...path, variantIndex]);

			if (found) return found;
		}
	}

	return null;
};

/**
 * Drops any variation the removal at `path` left empty - repeatedly, since
 * emptying a nested variation can empty its parent too.
 */
const pruneEmptyVariations = (
	moves: ChessStudyMove[],
	path: MovePath
): void => {
	for (let p = path; p.length > 1 && !getListAtPath(moves, p)?.length; ) {
		const parentPath = getParentMovePath(p);
		const parent = parentPath && getMoveAtPath(moves, parentPath);

		if (!parent || !parentPath) return;

		parent.variants.splice(p[p.length - 2], 1);
		p = parentPath;
	}
};

/** Drops the single move at `path` from its list. */
export const removeMoveAtPath = (
	moves: ChessStudyMove[],
	path: MovePath
): void => {
	const list = getListAtPath(moves, path);

	if (!list) return;

	list.splice(path[path.length - 1], 1);
	pruneEmptyVariations(moves, path);
};

/**
 * Drops the move at `path` and everything after it in the same line, returning
 * how many moves went.
 *
 * Only that line: variations hanging off the removed moves go with them, but a
 * move inside a variation takes the rest of its own branch and nothing else -
 * the line it branches from carries on. Removing the first move of a variation
 * therefore removes the variation.
 */
export const removeMovesFromPath = (
	moves: ChessStudyMove[],
	path: MovePath
): number => {
	const list = getListAtPath(moves, path);

	if (!list) return 0;

	const removed = list.splice(path[path.length - 1]);

	pruneEmptyVariations(moves, path);

	return countMoves(removed);
};

/** Move number of a move at `ply`, e.g. `4` for the 7th half-move of a game. */
export const moveNumberAtPly = (
	ply: number,
	firstPlayer: string,
	initialMoveNumber: number
): number =>
	initialMoveNumber + Math.floor((ply + (firstPlayer === 'b' ? 1 : 0)) / 2);

interface VariationRef {
	/** Path of the move the variation hangs off. */
	parentPath: MovePath;
	parentMove: ChessStudyMove;
	variantIndex: number;
}

/**
 * The variation that directly contains the move at `path`, or null when that
 * move is on the mainline.
 */
export const getVariationRef = (
	moves: ChessStudyMove[],
	path: MovePath
): VariationRef | null => {
	const parentPath = getParentMovePath(path);

	if (!parentPath) return null;

	const parentMove = getMoveAtPath(moves, parentPath);
	const variantIndex = path[path.length - 2];

	if (!parentMove?.variants?.[variantIndex]) return null;

	return { parentPath, parentMove, variantIndex };
};

/** Total moves in a line, nested variations included. */
export const countMoves = (moves: ChessStudyMove[]): number =>
	moves.reduce(
		(total, move) =>
			total +
			1 +
			(move.variants ?? []).reduce(
				(sub, variant) => sub + countMoves(variant.moves),
				0
			),
		0
	);

/**
 * Swaps a variation with the line it branches from, lifting it one level.
 *
 * The moves that currently follow the parent move become a variation in the
 * slot the promoted one vacated, so sibling order is preserved and nothing is
 * lost. If the parent move had no continuation, the variation simply becomes it.
 */
export const promoteVariationAtPath = (
	moves: ChessStudyMove[],
	path: MovePath,
	makeId: () => string
): boolean => {
	const ref = getVariationRef(moves, path);

	if (!ref) return false;

	const { parentPath, parentMove, variantIndex } = ref;
	const parentList = getListAtPath(moves, parentPath);

	if (!parentList) return false;

	const variant = parentMove.variants[variantIndex];
	const parentIndex = parentPath[parentPath.length - 1];

	const continuation = parentList.splice(parentIndex + 1);
	parentList.push(...variant.moves);

	if (continuation.length) {
		parentMove.variants[variantIndex] = {
			variantId: makeId(),
			parentMoveId: parentMove.moveId,
			moves: continuation,
		};
	} else {
		parentMove.variants.splice(variantIndex, 1);
	}

	return true;
};

/**
 * Promotes repeatedly until the move sits on the mainline. The loop is bounded
 * rather than `while (true)`: a tree that somehow failed to shrink would
 * otherwise hang the renderer.
 */
export const promoteToMainline = (
	moves: ChessStudyMove[],
	moveId: string,
	makeId: () => string
): boolean => {
	let promoted = false;

	for (let step = 0; step <= MAX_VARIATION_DEPTH; step++) {
		const path = findMovePath(moves, moveId);

		if (!path || pathDepth(path) === 0) return promoted;
		if (!promoteVariationAtPath(moves, path, makeId)) return promoted;

		promoted = true;
	}

	return promoted;
};

/** Removes the whole variation containing the move at `path`. */
export const removeVariationAtPath = (
	moves: ChessStudyMove[],
	path: MovePath
): boolean => {
	const ref = getVariationRef(moves, path);

	if (!ref) return false;

	ref.parentMove.variants.splice(ref.variantIndex, 1);

	return true;
};

/** Reorders a variation among its siblings. `delta` is -1 (up) or 1 (down). */
export const moveVariationAtPath = (
	moves: ChessStudyMove[],
	path: MovePath,
	delta: number
): boolean => {
	const ref = getVariationRef(moves, path);

	if (!ref) return false;

	const { parentMove, variantIndex } = ref;
	const target = variantIndex + delta;

	if (target < 0 || target >= parentMove.variants.length) return false;

	const [variant] = parentMove.variants.splice(variantIndex, 1);
	parentMove.variants.splice(target, 0, variant);

	return true;
};

/**
 * The move that follows the move at `moveId` in the line it sits in, or null at
 * the end of a line. Passing `null` asks for the root position, which only the
 * first mainline move can follow.
 *
 * Variations hanging off the move are not offered: they are alternatives to
 * this continuation rather than continuations themselves.
 */
export const getContinuation = (
	moves: ChessStudyMove[],
	moveId: string | null
): ChessStudyMove | null => {
	if (!moveId) return moves[0] ?? null;

	const path = findMovePath(moves, moveId);

	if (!path) return null;

	const list = getListAtPath(moves, path);

	return list?.[path[path.length - 1] + 1] ?? null;
};

/**
 * Every move that may follow the move at `moveId` - the continuation of its
 * line, then the first move of each variation hanging off it. Passing `null`
 * asks for the root position.
 *
 * The variations belong to the move *before* the alternatives they hold: a
 * variation on `moveId` replaces what comes after `moveId`, which is why
 * promoting one splices it in after the parent. So the whole set of replies
 * available at a position is reachable from the single move that precedes it -
 * and why an alternative to the game's very first move has nowhere to live.
 *
 * Order is the continuation first, then variations in their stored order, which
 * is the order they are listed in the move list.
 */
export const getReplies = (
	moves: ChessStudyMove[],
	moveId: string | null
): ChessStudyMove[] => {
	if (!moveId) return moves[0] ? [moves[0]] : [];

	const path = findMovePath(moves, moveId);
	const move = path && getMoveAtPath(moves, path);

	if (!path || !move) return [];

	const continuation = getListAtPath(moves, path)?.[path[path.length - 1] + 1];

	return [
		...(continuation ? [continuation] : []),
		...(move.variants ?? [])
			.map((variant) => variant.moves[0])
			.filter((first): first is ChessStudyMove => Boolean(first)),
	];
};

/** Every move in a line, nested variations included, flattened. */
export const flattenMoves = (moves: ChessStudyMove[]): ChessStudyMove[] =>
	moves.flatMap((move) => [
		move,
		...(move.variants ?? []).flatMap((variant) => flattenMoves(variant.moves)),
	]);

/**
 * The move at `moveId` and everything reachable from it: the rest of its line
 * and every variation growing out of those moves.
 *
 * The same span `removeMovesFromPath` deletes, which is what makes it the right
 * unit for both excluding a branch and judging how well one is known.
 */
export const collectSubtree = (
	moves: ChessStudyMove[],
	moveId: string
): ChessStudyMove[] => {
	const path = findMovePath(moves, moveId);
	const list = path && getListAtPath(moves, path);

	if (!path || !list) return [];

	return flattenMoves(list.slice(path[path.length - 1]));
};
