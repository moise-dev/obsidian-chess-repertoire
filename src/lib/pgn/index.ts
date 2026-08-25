import { JSONContent } from '@tiptap/react';
import { Chess } from 'chess.js';
import {
	CLASSIFICATIONS,
	CLASSIFICATION_ORDER,
	MoveClassification,
	readClassification,
} from 'src/lib/classification';
import { commentToPlainText, hasComment } from 'src/lib/comments';
import {
	MAX_VARIATION_DEPTH,
	MoveTree,
	ROOT_MOVE_ID,
	moveNumberAtPly,
} from 'src/lib/move-tree';
import { ChessRepertoireMove, Variant } from 'src/lib/storage';

/**
 * PGN import.
 *
 * chess.js keeps almost none of what a repertoire is made of: it discards variations,
 * has no notion of NAGs, and files comments by position rather than by move. So
 * the movetext is parsed here, and chess.js is used only to validate each move
 * and give it its from/to/before/after.
 */

/**
 * A position rather than a game: eight ranks and a side to move.
 *
 * Testing for a `/` instead would call every PGN a FEN, since a `[Link]` header
 * and a `1/2-1/2` result both contain one.
 */
const FEN_PATTERN =
	/^[1-8pnbrqkPNBRQK]+(?:\/[1-8pnbrqkPNBRQK]+){7}\s+[wb](?:\s|$)/;

export const looksLikeFen = (text: string): boolean =>
	FEN_PATTERN.test(text.trim());

/** `1.`, `12...`, or the `...` some exports write on its own. */
const MOVE_NUMBER = /^(?:\d+\.(?:\.\.)?|\.\.\.)$/;

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

const HEADER_LINE = /^\s*\[\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]\s*$/;

/** Numeric Annotation Glyphs this build has a label for. */
const BY_NAG = new Map<number, MoveClassification>(
	CLASSIFICATION_ORDER.flatMap((key) => {
		const { nag } = CLASSIFICATIONS[key];

		return nag === null ? [] : [[nag, key] as [number, MoveClassification]];
	})
);

/** The same judgements written onto the move: `Nf6??` rather than `Nf6 $4`. */
const BY_SUFFIX: Record<string, MoveClassification | undefined> = {
	'!!': 'brilliant',
	'!': 'great',
	'?!': 'inaccuracy',
	'?': 'mistake',
	'??': 'blunder',
	// `!?` is a NAG this build has no label for, so it is read and dropped
	// rather than turned into something it does not mean.
	'!?': undefined,
};

/** Splits `Nf6??` into the move and the judgement written onto it. */
const splitSuffix = (
	token: string
): { san: string; classification: MoveClassification | null } => {
	const match = token.match(/^(.*?)([!?]+)$/);

	if (!match) return { san: token, classification: null };

	return {
		san: match[1],
		classification: BY_SUFFIX[match[2]] ?? null,
	};
};

/** PGN comments are plain text; notes in a repertoire are TipTap documents. */
const toComment = (text: string): JSONContent => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** A move can carry more than one comment; they read as one note. */
const appendComment = (move: ChessRepertoireMove, text: string): void => {
	const existing = move.comment?.content?.[0]?.content?.[0]?.text;

	move.comment = toComment(existing ? `${existing} ${text}` : text);
};

const tokenize = (movetext: string): string[] =>
	// A `{}` comment is taken whole and first, so a `;` or a bracket inside one
	// is text. `;` outside one starts a comment that runs to end of line.
	(movetext.match(/\{[^}]*\}|;[^\n]*|\(|\)|\$\d+|[^\s()]+/g) ?? []).filter(
		(token) => !token.startsWith(';')
	);

interface ParseState {
	tokens: string[];
	index: number;
	makeId: () => string;
	/** Moves the parser could not play, so the caller can say so. */
	skipped: number;
}

/** Consumes tokens up to the `)` that closes the variation already opened. */
const skipVariation = (state: ParseState): void => {
	let depth = 1;

	while (state.index < state.tokens.length && depth > 0) {
		const token = state.tokens[state.index++];

		if (token === '(') depth++;
		else if (token === ')') depth--;
	}
};

type AttachVariation = (moves: ChessRepertoireMove[]) => void;

/**
 * Reads one line of play, recursing into its variations.
 *
 * `attachSibling` is how a variation on this line's *first* move is stored:
 * such a move has nothing before it to hang off, so the alternative belongs
 * beside this line rather than inside it. On the mainline that place is the
 * tree's `rootVariants`, so an alternative to the game's first move imports like
 * any other.
 */
const parseLine = (
	state: ParseState,
	startFen: string,
	depth: number,
	attachSibling: AttachVariation | null
): ChessRepertoireMove[] => {
	const chess = new Chess(startFen);
	const moves: ChessRepertoireMove[] = [];

	while (state.index < state.tokens.length) {
		const token = state.tokens[state.index];

		if (token === ')') {
			state.index++;
			return moves;
		}

		if (token === '(') {
			state.index++;

			const last = moves[moves.length - 1];

			if (!last) {
				skipVariation(state);
				continue;
			}

			// A variation replaces the move just played, and in this tree an
			// alternative to a move hangs off the move before it.
			const host = moves[moves.length - 2];
			const attach: AttachVariation | null = host
				? (line) =>
						host.variants.push({
							variantId: state.makeId(),
							parentMoveId: host.moveId,
							moves: line,
						})
				: attachSibling;

			// Hanging off a move nests one level; standing beside this line does
			// not, which is what keeps the count matching `pathDepth`.
			const lineDepth = host ? depth + 1 : depth;
			const line = parseLine(state, last.before, lineDepth, attach);

			if (line.length && attach && lineDepth <= MAX_VARIATION_DEPTH) {
				attach(line);
			}

			continue;
		}

		state.index++;

		if (MOVE_NUMBER.test(token) || RESULTS.has(token)) continue;

		if (token.startsWith('{')) {
			const text = token.slice(1, -1).trim().replace(/\s+/g, ' ');
			const last = moves[moves.length - 1];

			if (last && text) appendComment(last, text);

			continue;
		}

		if (token.startsWith('$')) {
			const classification = BY_NAG.get(Number(token.slice(1)));
			const last = moves[moves.length - 1];

			if (last && classification) last.classification = classification;

			continue;
		}

		const { san, classification } = splitSuffix(token);

		let played;

		try {
			played = chess.move(san, { strict: false });
		} catch {
			// Counted rather than thrown: the moves that did read are worth having,
			// and one bad move desyncs the rest of the line anyway.
			state.skipped++;
			continue;
		}

		moves.push({
			...played,
			moveId: state.makeId(),
			variants: [],
			shapes: [],
			comment: null,
			classification,
		} as ChessRepertoireMove);
	}

	return moves;
};

export interface ParsedPgn extends MoveTree {
	headers: Record<string, string>;
	/** The position the game starts from, `[FEN]` header included. */
	rootFEN: string;
	/** How many moves could not be played out; 0 for a clean import. */
	skipped: number;
}

export const parsePgn = (
	pgn: string,
	rootFEN: string,
	makeId: () => string
): ParsedPgn => {
	const headers: Record<string, string> = {};
	const movetextLines: string[] = [];

	for (const line of pgn.split('\n')) {
		const header = line.match(HEADER_LINE);

		if (header) headers[header[1]] = header[2];
		else movetextLines.push(line);
	}

	// A game that starts from a position says so in its headers; ignoring that
	// would play the moves out from the standard array, where none of them are
	// legal.
	const startFen = headers.FEN?.trim() || rootFEN;

	const state: ParseState = {
		tokens: tokenize(movetextLines.join('\n')),
		index: 0,
		makeId,
		skipped: 0,
	};

	// An alternative to the game's first move has no move to hang off, so it
	// lands beside the mainline rather than inside it.
	const rootVariants: Variant[] = [];

	const moves = parseLine(state, startFen, 0, (line) =>
		rootVariants.push({
			variantId: makeId(),
			parentMoveId: ROOT_MOVE_ID,
			moves: line,
		})
	);

	return {
		headers,
		rootFEN: startFen,
		moves,
		rootVariants,
		skipped: state.skipped,
	};
};

/**
 * What to call the repertoire. The `Opening` tag if the export wrote one, otherwise
 * the players - `?` is what a PGN writes for a field it does not have, so it
 * counts as absent.
 */
export const titleFromHeaders = (
	headers: Record<string, string>
): string | null => {
	const named = (value: string | undefined) =>
		value && value.trim() && value.trim() !== '?' ? value.trim() : null;

	const opening = named(headers.Opening);

	if (opening) return opening;

	const white = named(headers.White);
	const black = named(headers.Black);

	return white && black ? `${white} vs ${black}` : null;
};

/**
 * PGN export.
 *
 * The inverse of the importer above: comments, classifications and variations
 * all round-trip. A classification exports as its NAG where one exists
 * (`CLASSIFICATIONS[key].nag`); `excellent` and `good` are chess.com's own
 * invention and have none, so they are left off the move the same way an
 * import would drop a glyph this build cannot label.
 */

/** `{}` cannot contain a literal `}`, so it is folded into a `)`. */
const escapeComment = (text: string): string => text.replace(/\}/g, ')');

const moveToken = (move: ChessRepertoireMove): string => {
	let token = move.san;

	const classification = readClassification(move.classification);
	const nag = classification ? CLASSIFICATIONS[classification].nag : null;

	if (nag !== null) token += ` $${nag}`;

	if (hasComment(move.comment)) {
		token += ` {${escapeComment(commentToPlainText(move.comment, Infinity))}}`;
	}

	return token;
};

/**
 * One line of play, recursing into variations. `plyOffset` is the half-move
 * index of `moves[0]` counted from the repertoire's own start, matching
 * `plyAtPath` - a variation hangs off the move it replaces, so it starts at
 * the same ply as that move rather than one after it.
 *
 * `beforeFirst` holds the variations that belong to the first move, which has no
 * move before it to carry them. Only the mainline has any: they are the tree's
 * `rootVariants`, and PGN writes them in the same place it writes every other
 * alternative - straight after the move they replace.
 */
const serializeLine = (
	moves: ChessRepertoireMove[],
	plyOffset: number,
	firstPlayer: string,
	initialMoveNumber: number,
	forceFirstNumber: boolean,
	beforeFirst: Variant[] = []
): string => {
	const tokens: string[] = [];
	let needsNumber = forceFirstNumber;

	moves.forEach((move, i) => {
		const number = moveNumberAtPly(plyOffset + i, firstPlayer, initialMoveNumber);

		if (move.color === 'w') tokens.push(`${number}.`);
		else if (needsNumber) tokens.push(`${number}...`);

		tokens.push(moveToken(move));
		needsNumber = false;

		const variants: Variant[] = i > 0 ? moves[i - 1].variants : beforeFirst;

		for (const variant of variants) {
			tokens.push(
				`(${serializeLine(
					variant.moves,
					plyOffset + i,
					firstPlayer,
					initialMoveNumber,
					true
				)})`
			);
			// The variation just closed, so the mainline's own move number is
			// restated even if this next move is Black's.
			needsNumber = true;
		}
	});

	return tokens.join(' ');
};

/**
 * The whole repertoire as a movetext, from its own start rather than the standard
 * array where it began somewhere else.
 */
export const exportPgn = (
	tree: MoveTree,
	rootFEN: string,
	standardFEN: string,
	title: string | null
): string => {
	const chess = new Chess(rootFEN);
	const firstPlayer = chess.turn();
	const initialMoveNumber = chess.moveNumber();

	const headers: string[] = [];

	if (title) headers.push(`[Event "${title}"]`);

	if (rootFEN !== standardFEN) {
		headers.push('[SetUp "1"]', `[FEN "${rootFEN}"]`);
	}

	const movetext = serializeLine(
		tree.moves,
		0,
		firstPlayer,
		initialMoveNumber,
		true,
		tree.rootVariants as Variant[]
	);

	return [...headers, '', `${movetext}${movetext ? ' ' : ''}*`].join('\n');
};
