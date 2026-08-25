import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mergeDrillStats, mergeRepertoires } from '../src/lib/merge';
import {
	ChessRepertoireFileData,
	ChessRepertoireMove,
} from '../src/lib/storage';

let seq = 0;

const note = (text: string | undefined) => {
	if (!text) return null;

	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
	};
};

const mv = (
	san: string,
	options: {
		comment?: string;
		classification?: string;
		excluded?: boolean;
		variants?: unknown[];
		/** The position it reaches, which is where a continuation joins on. */
		after?: string;
	} = {}
): ChessRepertoireMove =>
	({
		san,
		// Real repertoires use nanoids, so the same move in two repertoires has two ids.
		moveId: `${san}-${seq++}`,
		color: 'w',
		after: options.after ?? `after-${san}`,
		variants: options.variants ?? [],
		shapes: [],
		comment: note(options.comment),
		classification: options.classification,
		excluded: options.excluded,
	} as unknown as ChessRepertoireMove);

const va = (moves: ChessRepertoireMove[], parentMoveId = '') => ({
	variantId: `v${seq++}`,
	parentMoveId,
	moves,
});

const ROOT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const repertoire = (
	moves: ChessRepertoireMove[],
	overrides: Partial<ChessRepertoireFileData> = {}
): ChessRepertoireFileData => ({
	version: '0.0.7',
	header: { title: null },
	moves,
	rootVariants: [],
	rootFEN: ROOT,
	...overrides,
});

/** The merged tree as `san` lines, mainline first, each variation indented. */
const outline = (moves: ChessRepertoireMove[], depth = 0): string[] =>
	moves.flatMap((move) => [
		`${'  '.repeat(depth)}${move.san}`,
		...(move.variants ?? []).flatMap((variant) =>
			outline(variant.moves as ChessRepertoireMove[], depth + 1)
		),
	]);

describe('mergeRepertoires', () => {
	it('leaves a single repertoire as it found it', () => {
		const merged = mergeRepertoires([repertoire([mv('e4'), mv('e5')])], '0.0.6');

		assert.deepEqual(outline(merged.repertoire.moves), ['e4', 'e5']);
		assert.equal(merged.skipped, 0);
	});

	it('adds nothing when the second repertoire says the same thing', () => {
		const merged = mergeRepertoires(
			[repertoire([mv('e4'), mv('e5')]), repertoire([mv('e4'), mv('e5')])],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.repertoire.moves), ['e4', 'e5']);
	});

	it('hangs a diverging line off the move it branches from', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4'), mv('e5'), mv('Nf3')]),
				repertoire([mv('e4'), mv('e5'), mv('Nc3'), mv('Nf6')]),
			],
			'0.0.6'
		);

		// Nc3 is an alternative to Nf3, so it hangs off e5 - the move before it.
		assert.deepEqual(outline(merged.repertoire.moves), [
			'e4',
			'e5',
			'  Nc3',
			'  Nf6',
			'Nf3',
		]);
	});

	it('keeps the first repertoire as the mainline', () => {
		const merged = mergeRepertoires(
			[repertoire([mv('e4'), mv('c5')]), repertoire([mv('e4'), mv('e5')])],
			'0.0.6'
		);

		assert.equal(merged.repertoire.moves[1].san, 'c5');
	});

	it("carries a grafted line's own variations with it", () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4'), mv('e5')]),
				repertoire([
					mv('e4'),
					mv('c5', { variants: [va([mv('e6'), mv('d4')])] }),
					mv('Nf3'),
				]),
			],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.repertoire.moves), [
			'e4',
			'  c5',
			'    e6',
			'    d4',
			'  Nf3',
			'e5',
		]);
	});

	it('descends into a line both repertoires already share', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4'), mv('e5'), mv('Nf3'), mv('Nc6')]),
				repertoire([mv('e4'), mv('e5'), mv('Nf3'), mv('Nf6')]),
			],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.repertoire.moves), [
			'e4',
			'e5',
			'Nf3',
			'  Nf6',
			'Nc6',
		]);
	});

	it('leaves out a repertoire that starts from another position', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4')]),
				repertoire([mv('Nf3')], { rootFEN: '8/8/4k3/8/8/4K3/8/8 w - - 0 1' }),
			],
			'0.0.6'
		);

		assert.equal(merged.skipped, 1);
		assert.deepEqual(outline(merged.repertoire.moves), ['e4']);
	});

	it('keeps an alternative first move beside the mainline', () => {
		const merged = mergeRepertoires(
			[repertoire([mv('e4'), mv('e5')]), repertoire([mv('d4'), mv('d5')])],
			'0.0.7'
		);

		// Nothing precedes it, so it hangs off the root rather than off a move -
		// but it is kept, not dropped.
		assert.deepEqual(outline(merged.repertoire.moves), ['e4', 'e5']);
		assert.deepEqual(
			merged.repertoire.rootVariants.map((variant) => outline(variant.moves)),
			[['d4', 'd5']]
		);
	});

	it('descends into an alternative first move it already has', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4'), mv('e5')], {
					rootVariants: [va([mv('d4'), mv('d5')])],
				}),
				repertoire([mv('d4'), mv('Nf6')]),
			],
			'0.0.7'
		);

		// d4 already stands at the root, so Nf6 joins it as a variation there
		// rather than opening a second d4 beside it.
		assert.equal(merged.repertoire.rootVariants.length, 1);
		assert.deepEqual(outline(merged.repertoire.rootVariants[0].moves), [
			'd4',
			'  Nf6',
			'd5',
		]);
	});

	it('fills in annotations the first repertoire lacks without overwriting any', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4', { comment: 'mine' }), mv('e5')]),
				repertoire([
					mv('e4', { comment: 'theirs', classification: 'Great' }),
					mv('e5', { comment: 'theirs', excluded: true }),
				]),
			],
			'0.0.6'
		);

		const [e4, e5] = merged.repertoire.moves;

		assert.equal(e4.comment?.content?.[0].content?.[0].text, 'mine');
		assert.equal(e4.classification, 'Great');
		assert.equal(e5.comment?.content?.[0].content?.[0].text, 'theirs');
		assert.equal(e5.excluded, true);
	});

	it('never shares a move with the repertoires it was built from', () => {
		const source = repertoire([mv('e4'), mv('e5')]);
		const merged = mergeRepertoires([source], '0.0.6');

		merged.repertoire.moves[0].comment = null;
		merged.repertoire.moves[0].variants.push(va([mv('c5')]));

		assert.equal(source.moves[0].variants.length, 0);
	});

	/**
	 * A note often holds an opening in instalments: a base line, then a repertoire
	 * opening from the position it ends in, and so on. Each one starts from a FEN
	 * the one before it reaches, so the merge has to join them end to end rather
	 * than demand they all share a root.
	 */
	describe('a repertoire that continues from another', () => {
		const AFTER_H6 = 'after-h6-position w KQkq - 0 5';
		const AFTER_NXE5 = 'after-Nxe5-position b KQ - 0 8';

		const base = () => repertoire([mv('c3'), mv('h6', { after: AFTER_H6 })]);

		const middle = () =>
			repertoire([mv('b4'), mv('Nxe5', { after: AFTER_NXE5 })], {
				rootFEN: AFTER_H6,
			});

		const tail = () =>
			repertoire([mv('Kf8'), mv('Ng6')], { rootFEN: AFTER_NXE5 });

		it('joins it onto the move that reaches the position it opens from', () => {
			const merged = mergeRepertoires([base(), middle()], '0.0.7');

			assert.equal(merged.skipped, 0);
			// b4 follows h6, so it hangs off h6 - the move that reaches its position.
			assert.deepEqual(outline(merged.repertoire.moves), [
				'c3',
				'h6',
				'  b4',
				'  Nxe5',
			]);
		});

		it('chains three of them end to end', () => {
			const merged = mergeRepertoires([base(), middle(), tail()], '0.0.7');

			assert.equal(merged.skipped, 0);
			assert.deepEqual(outline(merged.repertoire.moves), [
				'c3',
				'h6',
				'  b4',
				'  Nxe5',
				'    Kf8',
				'    Ng6',
			]);
		});

		it('joins them whatever order they are given in', () => {
			// The tail opens from a position only the middle brings into the tree,
			// so it has to wait for the pass after that one attaches.
			const merged = mergeRepertoires([base(), tail(), middle()], '0.0.7');

			assert.equal(merged.skipped, 0);
			assert.deepEqual(outline(merged.repertoire.moves), [
				'c3',
				'h6',
				'  b4',
				'  Nxe5',
				'    Kf8',
				'    Ng6',
			]);
		});

		it('ignores the clocks when matching the position', () => {
			// The same position reached by another move order disagrees about the
			// halfmove and fullmove counters, and is still the same position.
			const merged = mergeRepertoires(
				[base(), repertoire([mv('b4')], { rootFEN: `${AFTER_H6} 41 99` })],
				'0.0.7'
			);

			assert.equal(merged.skipped, 0);
			assert.deepEqual(outline(merged.repertoire.moves), ['c3', 'h6', '  b4']);
		});

		it('still counts one going nowhere in the tree as skipped', () => {
			const merged = mergeRepertoires(
				[base(), repertoire([mv('Nf3')], { rootFEN: 'nowhere w - - 0 1' })],
				'0.0.7'
			);

			assert.equal(merged.skipped, 1);
			assert.deepEqual(outline(merged.repertoire.moves), ['c3', 'h6']);
		});

		it('names every repertoire that joined in the title', () => {
			const merged = mergeRepertoires(
				[
					repertoire(base().moves, { header: { title: 'Base' } }),
					repertoire(middle().moves, {
						rootFEN: AFTER_H6,
						header: { title: 'Response' },
					}),
				],
				'0.0.7'
			);

			assert.equal(merged.repertoire.header.title, 'Base + Response');
		});
	});

	it('joins the titles and takes the first colour anyone recorded', () => {
		const merged = mergeRepertoires(
			[
				repertoire([mv('e4')], { header: { title: 'Italian' } }),
				repertoire([mv('e4')], { header: { title: 'Ruy' }, playerColor: 'b' }),
				repertoire([mv('e4')], { header: { title: 'Italian' } }),
			],
			'0.0.6'
		);

		assert.equal(merged.repertoire.header.title, 'Italian + Ruy');
		assert.equal(merged.repertoire.playerColor, 'b');
	});
});

describe('mergeDrillStats', () => {
	const data = (stats: Record<string, [number, number, number]>) => ({
		version: '0.0.1',
		stats: Object.fromEntries(
			Object.entries(stats).map(([id, [attempts, misses, lastSeen]]) => [
				id,
				{ attempts, misses, lastSeen },
			])
		),
	});

	it('adds up what the same move was asked in two repertoires', () => {
		const merged = mergeDrillStats([
			data({ a: [3, 1, 100] }),
			data({ a: [2, 2, 250] }),
		]);

		assert.deepEqual(merged.a, { attempts: 5, misses: 3, lastSeen: 250 });
	});

	it('keeps records only one of them had', () => {
		const merged = mergeDrillStats([
			data({ a: [1, 0, 5] }),
			data({ b: [4, 2, 9] }),
		]);

		assert.deepEqual(Object.keys(merged).sort(), ['a', 'b']);
	});

	it('leaves the records it was given alone', () => {
		const first = data({ a: [1, 0, 5] });

		mergeDrillStats([first, data({ a: [1, 1, 9] })]);

		assert.deepEqual(first.stats.a, { attempts: 1, misses: 0, lastSeen: 5 });
	});
});
