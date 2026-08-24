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
 *
 * The old representation was a `{ parentMoveIndex, variantIndex }` pair, which
 * structurally could not address anything below the first level.
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
 * Drops the move at `path` from its list, then removes any variation the
 * deletion left empty - repeatedly, since emptying a nested variation can empty
 * its parent too.
 */
export const removeMoveAtPath = (
	moves: ChessStudyMove[],
	path: MovePath
): void => {
	const list = getListAtPath(moves, path);

	if (!list) return;

	list.splice(path[path.length - 1], 1);

	for (let p = path; p.length > 1 && !getListAtPath(moves, p)?.length; ) {
		const parentPath = getParentMovePath(p);
		const parent = parentPath && getMoveAtPath(moves, parentPath);

		if (!parent || !parentPath) return;

		parent.variants.splice(p[p.length - 2], 1);
		p = parentPath;
	}
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
 * The moves that may follow the move at `moveId`, mainline continuation first.
 *
 * A move's `variants` are the alternatives to whatever follows it, so the
 * candidates after a move are its successor in its own line plus the first move
 * of each variation hanging off it. Passing `null` asks for the root position,
 * which only the first mainline move can follow.
 */
export const getContinuations = (
	moves: ChessStudyMove[],
	moveId: string | null
): ChessStudyMove[] => {
	if (!moveId) return moves[0] ? [moves[0]] : [];

	const path = findMovePath(moves, moveId);
	const move = path && getMoveAtPath(moves, path);

	if (!path || !move) return [];

	const list = getListAtPath(moves, path);
	const next = list?.[path[path.length - 1] + 1];

	const alternatives = (move.variants ?? [])
		.map((variant) => variant.moves[0])
		.filter(Boolean);

	return next ? [next, ...alternatives] : alternatives;
};
