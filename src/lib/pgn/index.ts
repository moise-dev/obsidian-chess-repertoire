import { JSONContent } from '@tiptap/react';
import { Chess } from 'chess.js';
import {
	CLASSIFICATIONS,
	CLASSIFICATION_ORDER,
	MoveClassification,
} from 'src/lib/classification';
import { MAX_VARIATION_DEPTH } from 'src/lib/move-tree';
import { ChessStudyMove } from 'src/lib/storage';

/**
 * PGN import.
 *
 * chess.js parses a PGN but keeps almost none of what a study is made of: it
 * discards variations outright, has no notion of NAGs, and files comments by
 * position rather than by move, so there is no way to hang one on the move it
 * belongs to. Everything a chess.com or Lichess export carries - the sidelines,
 * the `$2`s, the notes - would be dropped on the way in. So the movetext is
 * parsed here, and chess.js is used only to validate moves and give each one
 * its from/to/before/after.
 */

/**
 * A position, rather than a game: eight ranks and a side to move.
 *
 * Sniffing for a `/` is the obvious test and the wrong one - a PGN carrying a
 * `[Link "https://..."]` header, a `[Site]` pointing at Lichess, or a `1/2-1/2`
 * result all contain slashes, and every one of them would be handed to the FEN
 * parser and rejected.
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

/**
 * The same judgements written against the move instead of after it - `Nf6??`
 * rather than `Nf6 $4`. chess.com and Lichess both export the glyph form, but
 * hand-written and copy-pasted PGNs are full of these.
 */
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

/** PGN comments are plain text; notes in a study are TipTap documents. */
const toComment = (text: string): JSONContent => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** A move can carry more than one comment; they read as one note. */
const appendComment = (move: ChessStudyMove, text: string): void => {
	const existing = move.comment?.content?.[0]?.content?.[0]?.text;

	move.comment = toComment(existing ? `${existing} ${text}` : text);
};

const tokenize = (movetext: string): string[] =>
	movetext
		// `;` starts a comment that runs to the end of the line.
		.replace(/;[^\n]*/g, ' ')
		.match(/\{[^}]*\}|\(|\)|\$\d+|[^\s()]+/g) ?? [];

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

type AttachVariation = (moves: ChessStudyMove[]) => void;

/**
 * Reads one line of play, recursing into its variations.
 *
 * `attachSibling` is how a variation on this line's *first* move is stored:
 * such a move has nothing before it to hang off, so the alternative belongs
 * beside this line rather than inside it. On the mainline there is no such
 * place, which is the one thing a study cannot represent - alternatives to the
 * game's first move are read and dropped.
 */
const parseLine = (
	state: ParseState,
	startFen: string,
	depth: number,
	attachSibling: AttachVariation | null
): ChessStudyMove[] => {
	const chess = new Chess(startFen);
	const moves: ChessStudyMove[] = [];

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

			const line = parseLine(state, last.before, depth + 1, attach);

			if (line.length && attach && depth + 1 <= MAX_VARIATION_DEPTH) {
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
			// One unreadable move desyncs everything after it, so the rest of the
			// line will fail too. Counting them is more use than throwing: the
			// moves that did read are still worth having.
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
		} as ChessStudyMove);
	}

	return moves;
};

export interface ParsedPgn {
	headers: Record<string, string>;
	/** The position the game starts from, `[FEN]` header included. */
	rootFEN: string;
	moves: ChessStudyMove[];
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

	const moves = parseLine(state, startFen, 0, null);

	return { headers, rootFEN: startFen, moves, skipped: state.skipped };
};

/**
 * What to call the study. The `Opening` tag if the export wrote one, otherwise
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
