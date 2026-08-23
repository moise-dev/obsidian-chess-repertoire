import { ChessStudyMove } from 'src/lib/storage';

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
