import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
	exportPgn,
	looksLikeFen,
	parsePgn,
	titleFromHeaders,
} from '../src/lib/pgn';
import { ChessRepertoireMove } from '../src/lib/storage';

const ROOT_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The position 1. e4 e5 reaches, for building what a merge grafts onto it. */
const AFTER_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';

const ids = () => {
	let n = 0;
	return () => `id-${n++}`;
};

const parse = (pgn: string, rootFEN = ROOT_FEN) =>
	parsePgn(pgn, rootFEN, ids());

const sans = (moves: ChessRepertoireMove[]) =>
	moves.map((move) => move.san).join(' ');

const noteOn = (move: ChessRepertoireMove) =>
	move.comment?.content?.[0]?.content?.[0]?.text ?? null;

describe('looksLikeFen', () => {
	it('recognises a position', () => {
		assert.equal(looksLikeFen(ROOT_FEN), true);
		assert.equal(looksLikeFen('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), true);
	});

	it('does not mistake a PGN with a URL header for one', () => {
		// The bug this replaced: a `/` anywhere in the input meant "FEN", and
		// every chess.com export carries a link.
		const pgn = '[Link "https://www.chess.com/analysis/x/y"]\n\n1. e4 e5 1-0';

		assert.equal(looksLikeFen(pgn), false);
	});

	it('does not mistake a drawn result for one', () => {
		assert.equal(looksLikeFen('1. e4 e5 1/2-1/2'), false);
	});

	it('does not mistake bare movetext for one', () => {
		assert.equal(looksLikeFen('1. e4 e5 2. Nf3'), false);
	});
});

describe('parsePgn', () => {
	it('reads the mainline', () => {
		const { moves, skipped } = parse('1. e4 e5 2. Nf3 Nc6 *');

		assert.equal(sans(moves), 'e4 e5 Nf3 Nc6');
		assert.equal(skipped, 0);
	});

	it('hangs a comment on the move it follows', () => {
		const { moves } = parse('1. e4 {best by test} e5');

		assert.equal(noteOn(moves[0]), 'best by test');
		assert.equal(noteOn(moves[1]), null);
	});

	it('flattens a comment that was wrapped across lines', () => {
		const { moves } = parse('1. e4 {one\n   two\n   three} e5');

		assert.equal(noteOn(moves[0]), 'one two three');
	});

	it('does not read a $ inside a comment as a glyph', () => {
		// Straight from the wild: "Stronger threat $1 This move also put ..."
		const { moves } = parse('1. e4 {Stronger threat $1 and more} e5');

		assert.equal(noteOn(moves[0]), 'Stronger threat $1 and more');
		assert.equal(moves[0].classification, null);
	});

	it('does not let a semicolon inside a comment eat the rest of it', () => {
		// `;` starts a comment of its own in PGN, but not inside braces.
		const { moves, skipped } = parse('1. e4 {better; or so they say} e5');

		assert.equal(noteOn(moves[0]), 'better; or so they say');
		assert.equal(sans(moves), 'e4 e5');
		assert.equal(skipped, 0);
	});

	it('drops a semicolon comment that runs to the end of the line', () => {
		const { moves, skipped } = parse('1. e4 ; a note about e4\ne5 2. Nf3');

		assert.equal(sans(moves), 'e4 e5 Nf3');
		assert.equal(skipped, 0);
	});

	it('does not read parentheses inside a comment as a variation', () => {
		const { moves } = parse('1. e4 {the idea (and its point) is space} e5');

		assert.equal(sans(moves), 'e4 e5');
		assert.equal(noteOn(moves[0]), 'the idea (and its point) is space');
	});

	it('turns glyphs into classifications', () => {
		const { moves } = parse('1. e4 $3 e5 $2 2. Nf3 $1 Nc6 $4 3. Bc4 $6');

		assert.deepEqual(
			moves.map((move) => move.classification),
			['brilliant', 'mistake', 'great', 'blunder', 'inaccuracy']
		);
	});

	it('turns suffixes written onto the move into classifications', () => {
		const { moves } = parse('1. e4! e5?? 2. Nf3!! Nc6?!');

		assert.equal(sans(moves), 'e4 e5 Nf3 Nc6');
		assert.deepEqual(
			moves.map((move) => move.classification),
			['great', 'blunder', 'brilliant', 'inaccuracy']
		);
	});

	it('reads a glyph this build has no label for without breaking', () => {
		const { moves, skipped } = parse('1. e4 $5 e5!? 2. Nf3 $22');

		assert.equal(sans(moves), 'e4 e5 Nf3');
		assert.equal(skipped, 0);
		assert.deepEqual(
			moves.map((move) => move.classification),
			[null, null, null]
		);
	});

	it('hangs a variation off the move before the one it replaces', () => {
		// (2. d4) is an alternative to 2. Nf3, and in this tree alternatives to a
		// move live on the move before it - here 1... e5.
		const { moves } = parse('1. e4 e5 2. Nf3 (2. d4 exd4) Nc6');

		assert.equal(sans(moves), 'e4 e5 Nf3 Nc6');
		assert.equal(moves[2].variants.length, 0);
		assert.equal(moves[1].variants.length, 1);
		assert.equal(sans(moves[1].variants[0].moves), 'd4 exd4');
	});

	it('keeps comments and glyphs inside a variation', () => {
		const { moves } = parse('1. e4 e5 2. Nf3 (2. d4 $2 {too early} exd4) Nc6');

		const [first, second] = moves[1].variants[0].moves;

		assert.equal(first.classification, 'mistake');
		assert.equal(noteOn(first), 'too early');
		assert.equal(second.san, 'exd4');
	});

	it('nests a variation inside a variation', () => {
		const { moves } = parse('1. e4 e5 2. Nf3 (2. d4 exd4 3. c3 (3. Qxd4)) Nc6');

		const line = moves[1].variants[0].moves;

		assert.equal(sans(line), 'd4 exd4 c3');
		assert.equal(sans(line[1].variants[0].moves), 'Qxd4');
	});

	it("makes an alternative to a variation's first move a sibling of it", () => {
		// (2. d4) and (2. Bc4) are both alternatives to 2. Nf3, so they belong
		// beside each other rather than one inside the other.
		const { moves } = parse('1. e4 e5 2. Nf3 (2. d4 (2. Bc4)) Nc6');

		assert.equal(moves[1].variants.length, 2);
		assert.equal(sans(moves[1].variants[0].moves), 'Bc4');
		assert.equal(sans(moves[1].variants[1].moves), 'd4');
	});

	it("keeps an alternative to the game's very first move at the root", () => {
		// Nothing precedes it, so it hangs off the starting position rather than
		// off a move.
		const { moves, rootVariants, skipped } = parse('1. e4 (1. d4 d5) e5 2. Nf3');

		assert.equal(sans(moves), 'e4 e5 Nf3');
		assert.equal(skipped, 0);
		assert.equal(moves[0].variants.length, 0, 'not hung off the first move');
		assert.equal(rootVariants.length, 1);
		assert.equal(sans(rootVariants[0].moves), 'd4 d5');
	});

	it('keeps several alternative first moves side by side', () => {
		const { moves, rootVariants } = parse('1. e4 (1. d4) (1. c4) e5');

		assert.equal(sans(moves), 'e4 e5');
		// In the order the PGN gives them, like any other run of siblings.
		assert.deepEqual(
			rootVariants.map((variant) => sans(variant.moves)),
			['d4', 'c4']
		);
	});

	it('reads alternative first moves for a game that starts from a position', () => {
		// The case this exists for: a position imported mid-game, where the first
		// move is a real choice rather than an opening.
		const blackToMove =
			'r1bq2nr/pppp1kp1/1b5p/nP2N3/4P3/2P5/P2P1PPP/RNBQK2R b KQ - 0 8';
		const { moves, rootVariants, skipped } = parse(
			'8... Kf8 (8... Ke8) (8... Ke7 9. O-O) 9. O-O',
			blackToMove
		);

		assert.equal(skipped, 0);
		assert.equal(sans(moves), 'Kf8 O-O');
		assert.deepEqual(
			rootVariants.map((variant) => sans(variant.moves)),
			['Ke8', 'Ke7 O-O']
		);
	});

	it('starts from the position in a FEN header', () => {
		const pgn =
			'[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 Kd7';

		const { moves, rootFEN, skipped } = parse(pgn);

		assert.equal(rootFEN, '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
		assert.equal(sans(moves), 'e4 Kd7');
		assert.equal(skipped, 0);
	});

	it('counts moves it could not play instead of throwing', () => {
		const { moves, skipped } = parse('1. e4 e5 2. Qxf7 Nc6');

		assert.equal(sans(moves), 'e4 e5');
		assert.ok(skipped > 0);
	});

	it('reads a chess.com export whole', () => {
		const pgn = [
			'[White "Gothamchess"]',
			'[Black "Opponent"]',
			'[Result "1-0"]',
			'[Link "https://www.chess.com/analysis/collection/x/y/games?move=66"]',
			'',
			'1. e4 e5 2. Nf3 Nf6 3. Nxe5 Qe7 4. d4 Nxe4 $2 5. Bd3 $1 Nxf2 $4 6. Kxf2',
			'd6 {a comment that (parenthetically) mentions $1 and wraps} 7. Nf3 (7.',
			'Nc4 $4 {this idea is a mistake} 7... d5) 7... d5 1-0',
		].join('\n');

		const { moves, headers, skipped } = parse(pgn);

		assert.equal(skipped, 0);
		assert.equal(headers.Link.startsWith('https://'), true);
		assert.equal(
			sans(moves),
			'e4 e5 Nf3 Nf6 Nxe5 Qe7 d4 Nxe4 Bd3 Nxf2 Kxf2 d6 Nf3 d5'
		);

		const nxe4 = moves.find((move) => move.san === 'Nxe4');
		assert.equal(nxe4?.classification, 'mistake');

		const d6 = moves.find((move) => move.san === 'd6');
		assert.equal(
			noteOn(d6 as ChessRepertoireMove),
			'a comment that (parenthetically) mentions $1 and wraps'
		);

		// 7. Nf3 has a sideline, so it hangs off 6... d6, the move before it.
		assert.equal(sans(d6?.variants[0].moves ?? []), 'Nc4 d5');
	});
});

describe('titleFromHeaders', () => {
	it('prefers the opening', () => {
		assert.equal(
			titleFromHeaders({ Opening: 'Petrov Defence', White: 'a', Black: 'b' }),
			'Petrov Defence'
		);
	});

	it('falls back to the players', () => {
		assert.equal(
			titleFromHeaders({ White: 'Gothamchess', Black: 'Opponent' }),
			'Gothamchess vs Opponent'
		);
	});

	it('treats the placeholders a PGN writes as absent', () => {
		assert.equal(titleFromHeaders({ White: '?', Black: '?' }), null);
		assert.equal(titleFromHeaders({}), null);
	});
});

describe('exportPgn', () => {
	it('writes a plain mainline', () => {
		const parsed = parse('1. e4 e5 2. Nf3 Nc6');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 2. Nf3 Nc6 *'
		);
	});

	it('carries classifications back out as NAGs', () => {
		const parsed = parse('1. e4! e5?? 2. Nf3!!');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 $1 e5 $4 2. Nf3 $3 *'
		);
	});

	it('carries comments back out as {}', () => {
		const parsed = parse('1. e4 {best by test} e5');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 {best by test} e5 *'
		);
	});

	it('writes a variation right after the move it replaces', () => {
		const parsed = parse('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *'
		);
	});

	it('restates the move number for the mainline move right after a variation', () => {
		const parsed = parse('1. e4 e5 2. Nf3 (2. Bc4) Nc6');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 *'
		);
	});

	it('adds a FEN header for a repertoire that starts elsewhere, and an Event header for its title', () => {
		const blackToMove = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 7';
		const parsed = parse('7... Kd7 8. e4', blackToMove);

		assert.equal(
			exportPgn(parsed, blackToMove, ROOT_FEN, 'King and pawn'),
			`[Event "King and pawn"]\n[SetUp "1"]\n[FEN "${blackToMove}"]\n\n7... Kd7 8. e4 *`
		);
	});

	it('writes an alternative first move right after the move it replaces', () => {
		const parsed = parse('1. e4 (1. d4 d5) e5');

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 (1. d4 d5) 1... e5 *'
		);
	});

	it('round-trips alternative first moves from a position', () => {
		const blackToMove =
			'r1bq2nr/pppp1kp1/1b5p/nP2N3/4P3/2P5/P2P1PPP/RNBQK2R b KQ - 0 8';
		const original = parse(
			'8... Kf8 (8... Ke8) (8... Ke7 9. O-O) 9. O-O',
			blackToMove
		);
		const reparsed = parse(
			exportPgn(original, blackToMove, ROOT_FEN, null),
			blackToMove
		);

		assert.equal(sans(reparsed.moves), sans(original.moves));
		assert.deepEqual(
			reparsed.rootVariants.map((variant) => sans(variant.moves)),
			original.rootVariants.map((variant) => sans(variant.moves))
		);
	});

	/**
	 * A variation on the last move of a line is an alternative to a move that is
	 * not there, so it is what follows the line rather than a branch off it. A
	 * merge makes these whenever one repertoire carries on from where another
	 * stopped - and they used to vanish on export, taking the whole continuation
	 * with them.
	 */
	it('writes the line on into a variation hanging off its last move', () => {
		const parsed = parse('1. e4 e5');
		// What a merge grafting "2. Nf3 Nc6" onto e5 produces: a second repertoire
		// opening from the position e5 reaches.
		const tail = parse('2. Nf3 Nc6', AFTER_E5).moves;

		parsed.moves[1].variants.push({
			variantId: 'v',
			parentMoveId: parsed.moves[1].moveId,
			moves: tail,
		});

		assert.equal(
			exportPgn(parsed, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 2. Nf3 Nc6 *'
		);
	});

	it('makes the rest of them alternatives to the move that carries on', () => {
		const parsed = parse('1. e4 e5');
		const push = (san: string) =>
			parsed.moves[1].variants.push({
				variantId: `v-${san}`,
				parentMoveId: parsed.moves[1].moveId,
				moves: parse(`2. ${san}`, AFTER_E5).moves,
			});

		push('Nf3');
		push('Bc4');
		push('d4');

		// PGN has room for one continuation, so the first takes the line on and
		// the others become alternatives to it - the same tree when read back.
		const pgn = exportPgn(parsed, ROOT_FEN, ROOT_FEN, null);

		assert.equal(pgn, '\n1. e4 e5 2. Nf3 (2. Bc4) (2. d4) *');

		const back = parse(pgn);

		assert.equal(sans(back.moves), 'e4 e5 Nf3');
		assert.deepEqual(
			back.moves[1].variants.map((variant) => sans(variant.moves)),
			['Bc4', 'd4']
		);
	});

	it('round-trips through the importer', () => {
		const original =
			'1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 $1 {developing} Nc6 3. Bb5 a6';
		const parsed = parse(original);
		const reparsed = parse(exportPgn(parsed, ROOT_FEN, ROOT_FEN, null)).moves;

		assert.equal(sans(reparsed), sans(parsed.moves));
		assert.deepEqual(
			reparsed.map((move) => move.classification),
			parsed.moves.map((move) => move.classification)
		);
		assert.equal(
			reparsed[0].variants[0].moves.map((m) => m.san).join(' '),
			parsed.moves[0].variants[0].moves.map((m) => m.san).join(' ')
		);
	});
});
