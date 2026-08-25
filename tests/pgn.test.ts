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

	it("drops an alternative to the game's very first move", () => {
		// Nothing precedes it, so the tree has nowhere to put it. The rest of the
		// game still has to survive.
		const { moves, skipped } = parse('1. e4 (1. d4 d5) e5 2. Nf3');

		assert.equal(sans(moves), 'e4 e5 Nf3');
		assert.equal(skipped, 0);
		assert.equal(moves[0].variants.length, 0);
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
		const { moves } = parse('1. e4 e5 2. Nf3 Nc6');

		assert.equal(
			exportPgn(moves, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 2. Nf3 Nc6 *'
		);
	});

	it('carries classifications back out as NAGs', () => {
		const { moves } = parse('1. e4! e5?? 2. Nf3!!');

		assert.equal(
			exportPgn(moves, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 $1 e5 $4 2. Nf3 $3 *'
		);
	});

	it('carries comments back out as {}', () => {
		const { moves } = parse('1. e4 {best by test} e5');

		assert.equal(
			exportPgn(moves, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 {best by test} e5 *'
		);
	});

	it('writes a variation right after the move it replaces', () => {
		const { moves } = parse('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6');

		assert.equal(
			exportPgn(moves, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *'
		);
	});

	it('restates the move number for the mainline move right after a variation', () => {
		const { moves } = parse('1. e4 e5 2. Nf3 (2. Bc4) Nc6');

		assert.equal(
			exportPgn(moves, ROOT_FEN, ROOT_FEN, null),
			'\n1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 *'
		);
	});

	it('adds a FEN header for a repertoire that starts elsewhere, and an Event header for its title', () => {
		const blackToMove = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 7';
		const { moves } = parse('7... Kd7 8. e4', blackToMove);

		assert.equal(
			exportPgn(moves, blackToMove, ROOT_FEN, 'King and pawn'),
			`[Event "King and pawn"]\n[SetUp "1"]\n[FEN "${blackToMove}"]\n\n7... Kd7 8. e4 *`
		);
	});

	it('round-trips through the importer', () => {
		const original =
			'1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 $1 {developing} Nc6 3. Bb5 a6';
		const { moves } = parse(original);
		const reparsed = parse(exportPgn(moves, ROOT_FEN, ROOT_FEN, null)).moves;

		assert.equal(sans(reparsed), sans(moves));
		assert.deepEqual(
			reparsed.map((move) => move.classification),
			moves.map((move) => move.classification)
		);
		assert.equal(
			reparsed[0].variants[0].moves.map((m) => m.san).join(' '),
			moves[0].variants[0].moves.map((m) => m.san).join(' ')
		);
	});
});
