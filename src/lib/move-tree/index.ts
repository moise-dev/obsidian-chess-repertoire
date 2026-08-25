import { ChessRepertoireMove } from 'src/lib/storage';

/** How deep variations may nest. The mainline is depth 0. */
export const MAX_VARIATION_DEPTH = 4;

/**
 * What a root variation names as its parent: the starting position, which is no
 * move. A `moveId` is a nanoid, so the empty string can never collide with one.
 *
 * Here rather than beside `Variant` in storage so that this module stays free of
 * runtime imports - storage reaches Obsidian, and the tree is pure data.
 */
export const ROOT_MOVE_ID = '';

/**
 * The whole tree: the mainline, and the variations hanging off the root position.
 *
 * A variation belongs to the move *before* the alternatives it holds, and the
 * first move of a repertoire has no such move - so alternatives to it live in
 * `rootVariants`, which is the root position's own `variants` list. Everything
 * here takes the pair rather than the mainline alone, so no reader of the tree
 * can quietly miss a line that starts at the root.
 *
 * Generic over the move type only so an immer draft survives a lookup: passing a
 * `Draft<ChessRepertoireFileData>` gets draft moves back.
 */
export interface MoveTree<T extends ChessRepertoireMove = ChessRepertoireMove> {
	moves: T[];
	rootVariants: { variantId: string; parentMoveId: string; moves: T[] }[];
}

/**
 * Where the root position sits in a `MovePath`: one before the mainline's first
 * move.
 *
 * Chosen rather than invented so the arithmetic keeps working. `plyAtPath` adds
 * `1 + index` per level, so a root variation's first move lands on ply 0 the way
 * the mainline's does; `promoteVariationAtPath` splices after index -1, which is
 * the whole mainline, so promoting a root alternative needs no special case.
 */
export const ROOT_INDEX = -1;

/**
 * Address of a move in the tree.
 *
 * `[i]` is mainline move `i`. Descending into a variation appends the variation
 * index and the move index within it, so `[i, v, j]` is move `j` of variation
 * `v` hanging off mainline move `i`, and `[i, v, j, w, k]` is one level deeper.
 * Length is always odd: `1 + 2 * depth`.
 *
 * `[ROOT_INDEX]` is the root position itself, which is no move; `[ROOT_INDEX, v,
 * j]` is move `j` of the `v`th alternative to the first move.
 */
export type MovePath = number[];

/** The root position: a place in the tree, but not a move. */
export const ROOT_PATH: MovePath = [ROOT_INDEX];

export const isRootPath = (path: MovePath): boolean =>
	path.length === 1 && path[0] === ROOT_INDEX;

/** Whether `path` names a move on the mainline itself. */
export const isMainlinePath = (path: MovePath): boolean =>
	path.length === 1 && path[0] !== ROOT_INDEX;

/**
 * How deeply nested the move at `path` is, with the mainline at 0.
 *
 * A root alternative is a whole line branching from the start rather than a
 * variation inside one, so it counts as 0 too: it is the mainline's peer, and
 * lines under it may nest as deeply as lines under the mainline.
 */
export const pathDepth = (path: MovePath): number =>
	(path.length - 1) / 2 - (path[0] === ROOT_INDEX ? 1 : 0);

/**
 * Half-move number of the move at `path`, counting from 0 at the first mainline
 * move. A variation hanging off a move at ply `p` starts at ply `p + 1`, so this
 * stays correct however deep the nesting goes - and correct for a root variation
 * too, whose first move sits at ply 0 because the root itself is at -1.
 */
export const plyAtPath = (path: MovePath): number => {
	let ply = path[0] ?? 0;

	for (let i = 2; i < path.length; i += 2) ply += 1 + path[i];

	return ply;
};

/** The array of moves that directly contains the move at `path`. */
export const getListAtPath = <T extends ChessRepertoireMove>(
	tree: MoveTree<T>,
	path: MovePath
): T[] | null => {
	let list = tree.moves;
	let i = 0;

	// The root's own variations are the tree's rather than a move's, so the
	// first step down is taken here instead of in the loop.
	if (path[0] === ROOT_INDEX && path.length > 1) {
		const variant = tree.rootVariants[path[1]];

		if (!variant) return null;

		list = variant.moves;
		i = 2;
	}

	for (; i + 2 < path.length; i += 2) {
		const variant = list[path[i]]?.variants?.[path[i + 1]];

		if (!variant) return null;

		list = variant.moves as T[];
	}

	return list;
};

export const getMoveAtPath = <T extends ChessRepertoireMove>(
	tree: MoveTree<T>,
	path: MovePath
): T | null => {
	if (!path.length || isRootPath(path)) return null;

	const list = getListAtPath(tree, path);

	return list?.[path[path.length - 1]] ?? null;
};

/**
 * Path of the position a variation hangs off, or null when at the mainline.
 *
 * For a root alternative that is `ROOT_PATH`, which names a position rather than
 * a move - so `getMoveAtPath` on it is null, and callers wanting the variation's
 * home should ask `getVariationRef` instead.
 */
export const getParentMovePath = (path: MovePath): MovePath | null =>
	path.length > 1 ? path.slice(0, -2) : null;

const findInLine = (
	moves: ChessRepertoireMove[],
	moveId: string,
	prefix: MovePath
): MovePath | null => {
	for (const [moveIndex, move] of moves.entries()) {
		const path = [...prefix, moveIndex];

		if (move.moveId === moveId) return path;

		for (const [variantIndex, variant] of (move.variants ?? []).entries()) {
			const found = findInLine(variant.moves, moveId, [...path, variantIndex]);

			if (found) return found;
		}
	}

	return null;
};

export const findMovePath = (
	tree: MoveTree,
	moveId: string
): MovePath | null => {
	const onMainline = findInLine(tree.moves, moveId, []);

	if (onMainline) return onMainline;

	for (const [variantIndex, variant] of tree.rootVariants.entries()) {
		const found = findInLine(variant.moves, moveId, [ROOT_INDEX, variantIndex]);

		if (found) return found;
	}

	return null;
};

interface VariationRef<T extends ChessRepertoireMove = ChessRepertoireMove> {
	/** Path of the move the variation hangs off, or `ROOT_PATH`. */
	parentPath: MovePath;
	/**
	 * The list the variation sits in: a move's `variants`, or the tree's
	 * `rootVariants` where it branches from the start. Handed over rather than
	 * the move that owns it, because the root owns one and is not a move.
	 */
	variants: MoveTree<T>['rootVariants'];
	variantIndex: number;
}

/**
 * The variation that directly contains the move at `path`, or null when that
 * move is on the mainline.
 */
export const getVariationRef = <T extends ChessRepertoireMove>(
	tree: MoveTree<T>,
	path: MovePath
): VariationRef<T> | null => {
	const parentPath = getParentMovePath(path);

	if (!parentPath) return null;

	const variantIndex = path[path.length - 2];

	if (isRootPath(parentPath)) {
		return tree.rootVariants[variantIndex]
			? { parentPath, variants: tree.rootVariants, variantIndex }
			: null;
	}

	const parentMove = getMoveAtPath(tree, parentPath);

	if (!parentMove?.variants?.[variantIndex]) return null;

	return {
		parentPath,
		variants: parentMove.variants as MoveTree<T>['rootVariants'],
		variantIndex,
	};
};

/**
 * Drops any variation the removal at `path` left empty - repeatedly, since
 * emptying a nested variation can empty its parent too.
 */
const pruneEmptyVariations = (tree: MoveTree, path: MovePath): void => {
	for (let p = path; p.length > 1 && !getListAtPath(tree, p)?.length; ) {
		const ref = getVariationRef(tree, p);

		if (!ref) return;

		ref.variants.splice(ref.variantIndex, 1);
		p = ref.parentPath;
	}
};

/**
 * Keeps the mainline occupied while the tree still holds a line.
 *
 * Deleting the whole mainline out from under a root alternative would leave that
 * alternative with nothing to be an alternative to: the move list draws
 * variations underneath the first move, and there would be no first move to draw
 * them under. The oldest alternative takes the vacant mainline instead.
 */
const reseatMainline = (tree: MoveTree): void => {
	if (tree.moves.length || !tree.rootVariants.length) return;

	const [promoted] = tree.rootVariants.splice(0, 1);

	tree.moves.push(...promoted.moves);
};

/** Drops the single move at `path` from its list. */
export const removeMoveAtPath = (tree: MoveTree, path: MovePath): void => {
	const list = getListAtPath(tree, path);

	if (!list) return;

	list.splice(path[path.length - 1], 1);
	pruneEmptyVariations(tree, path);
	reseatMainline(tree);
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
export const removeMovesFromPath = (tree: MoveTree, path: MovePath): number => {
	const list = getListAtPath(tree, path);

	if (!list) return 0;

	const removed = list.splice(path[path.length - 1]);

	pruneEmptyVariations(tree, path);
	reseatMainline(tree);

	return countMoves(removed);
};

/** Move number of a move at `ply`, e.g. `4` for the 7th half-move of a game. */
export const moveNumberAtPly = (
	ply: number,
	firstPlayer: string,
	initialMoveNumber: number
): number =>
	initialMoveNumber + Math.floor((ply + (firstPlayer === 'b' ? 1 : 0)) / 2);

/** Total moves in a line, nested variations included. */
export const countMoves = (moves: ChessRepertoireMove[]): number =>
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

/** Total moves in the whole tree, root alternatives included. */
export const countTree = (tree: MoveTree): number =>
	countMoves(tree.moves) +
	tree.rootVariants.reduce((sum, variant) => sum + countMoves(variant.moves), 0);

/**
 * Swaps a variation with the line it branches from, lifting it one level.
 *
 * The moves that currently follow the parent move become a variation in the
 * slot the promoted one vacated, so sibling order is preserved and nothing is
 * lost. If the parent move had no continuation, the variation simply becomes it.
 *
 * A root alternative promotes the same way, and the arithmetic needs no help:
 * its parent sits at index -1, so "everything after the parent" is the whole
 * mainline, and the two lines trade places.
 */
export const promoteVariationAtPath = (
	tree: MoveTree,
	path: MovePath,
	makeId: () => string
): boolean => {
	const ref = getVariationRef(tree, path);

	if (!ref) return false;

	const { parentPath, variants, variantIndex } = ref;
	const parentList = getListAtPath(tree, parentPath);

	if (!parentList) return false;

	const variant = variants[variantIndex];
	const parentIndex = parentPath[parentPath.length - 1];

	const continuation = parentList.splice(parentIndex + 1);
	parentList.push(...variant.moves);

	if (continuation.length) {
		variants[variantIndex] = {
			variantId: makeId(),
			parentMoveId: getMoveAtPath(tree, parentPath)?.moveId ?? ROOT_MOVE_ID,
			moves: continuation,
		};
	} else {
		variants.splice(variantIndex, 1);
	}

	return true;
};

/**
 * Promotes repeatedly until the move sits on the mainline. The loop is bounded
 * rather than `while (true)`: a tree that somehow failed to shrink would
 * otherwise hang the renderer.
 *
 * The bound allows one step more than the nesting depth, since a line at depth 0
 * still needs a promotion when it is a root alternative rather than the mainline.
 */
export const promoteToMainline = (
	tree: MoveTree,
	moveId: string,
	makeId: () => string
): boolean => {
	let promoted = false;

	for (let step = 0; step <= MAX_VARIATION_DEPTH + 1; step++) {
		const path = findMovePath(tree, moveId);

		if (!path || isMainlinePath(path)) return promoted;
		if (!promoteVariationAtPath(tree, path, makeId)) return promoted;

		promoted = true;
	}

	return promoted;
};

/** Removes the whole variation containing the move at `path`. */
export const removeVariationAtPath = (
	tree: MoveTree,
	path: MovePath
): boolean => {
	const ref = getVariationRef(tree, path);

	if (!ref) return false;

	ref.variants.splice(ref.variantIndex, 1);

	return true;
};

/** Reorders a variation among its siblings. `delta` is -1 (up) or 1 (down). */
export const moveVariationAtPath = (
	tree: MoveTree,
	path: MovePath,
	delta: number
): boolean => {
	const ref = getVariationRef(tree, path);

	if (!ref) return false;

	const { variants, variantIndex } = ref;
	const target = variantIndex + delta;

	if (target < 0 || target >= variants.length) return false;

	const [variant] = variants.splice(variantIndex, 1);
	variants.splice(target, 0, variant);

	return true;
};

/**
 * The move that follows the move at `moveId` in the line it sits in, or null at
 * the end of a line. Passing `null` asks for the root position, whose line is
 * the mainline.
 *
 * Variations hanging off the move are not offered: they are alternatives to
 * this continuation rather than continuations themselves.
 */
export const getContinuation = (
	tree: MoveTree,
	moveId: string | null
): ChessRepertoireMove | null => {
	if (!moveId) return tree.moves[0] ?? null;

	const path = findMovePath(tree, moveId);

	if (!path) return null;

	const list = getListAtPath(tree, path);

	return list?.[path[path.length - 1] + 1] ?? null;
};

/**
 * Every move that may follow the move at `moveId` - the continuation of its
 * line, then the first move of each variation hanging off it. Passing `null`
 * asks for the root position, which answers with the mainline's first move and
 * then the first move of each root alternative.
 *
 * The variations belong to the move *before* the alternatives they hold: a
 * variation on `moveId` replaces what comes after `moveId`, which is why
 * promoting one splices it in after the parent. So the whole set of replies
 * available at a position is reachable from the single move that precedes it -
 * and at the start, where no move does, from `rootVariants`.
 *
 * Order is the continuation first, then variations in their stored order, which
 * is the order they are listed in the move list.
 */
export const getReplies = (
	tree: MoveTree,
	moveId: string | null
): ChessRepertoireMove[] => {
	const firstMoves = (variants: MoveTree['rootVariants']) =>
		variants
			.map((variant) => variant.moves[0])
			.filter((first): first is ChessRepertoireMove => Boolean(first));

	if (!moveId) {
		return [
			...(tree.moves[0] ? [tree.moves[0]] : []),
			...firstMoves(tree.rootVariants),
		];
	}

	const path = findMovePath(tree, moveId);
	const move = path && getMoveAtPath(tree, path);

	if (!path || !move) return [];

	const continuation = getListAtPath(tree, path)?.[path[path.length - 1] + 1];

	return [
		...(continuation ? [continuation] : []),
		...firstMoves((move.variants ?? []) as MoveTree['rootVariants']),
	];
};

/** Every move in a line, nested variations included, flattened. */
export const flattenMoves = (
	moves: ChessRepertoireMove[]
): ChessRepertoireMove[] =>
	moves.flatMap((move) => [
		move,
		...(move.variants ?? []).flatMap((variant) => flattenMoves(variant.moves)),
	]);

/** Every move in the tree, root alternatives included. */
export const flattenTree = (tree: MoveTree): ChessRepertoireMove[] => [
	...flattenMoves(tree.moves),
	...tree.rootVariants.flatMap((variant) => flattenMoves(variant.moves)),
];

/**
 * The move at `moveId` and everything reachable from it: the rest of its line
 * and every variation growing out of those moves.
 *
 * The same span `removeMovesFromPath` deletes, which is what makes it the right
 * unit for both excluding a branch and judging how well one is known.
 */
export const collectSubtree = (
	tree: MoveTree,
	moveId: string
): ChessRepertoireMove[] => {
	const path = findMovePath(tree, moveId);
	const list = path && getListAtPath(tree, path);

	if (!path || !list) return [];

	return flattenMoves(list.slice(path[path.length - 1]));
};
