import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mergeDrillStats, mergeStudies } from '../src/lib/merge';
import { ChessStudyFileData, ChessStudyMove } from '../src/lib/storage';

let seq = 0;
const mv = (
	san: string,
	options: {
		comment?: string;
		classification?: string;
		excluded?: boolean;
		variants?: unknown[];
	} = {}
): ChessStudyMove =>
	({
		san,
		// Real studies use nanoids, so the same move in two studies has two ids.
		moveId: `${san}-${seq++}`,
		color: 'w',
		variants: options.variants ?? [],
		shapes: [],
		comment: options.comment
			? {
					type: 'doc',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: options.comment }] },
					],
			  }
			: null,
		classification: options.classification,
		excluded: options.excluded,
	} as unknown as ChessStudyMove);

const va = (moves: ChessStudyMove[], parentMoveId = '') => ({
	variantId: `v${seq++}`,
	parentMoveId,
	moves,
});

const ROOT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const study = (
	moves: ChessStudyMove[],
	overrides: Partial<ChessStudyFileData> = {}
): ChessStudyFileData => ({
	version: '0.0.6',
	header: { title: null },
	moves,
	rootFEN: ROOT,
	...overrides,
});

/** The merged tree as `san` lines, mainline first, each variation indented. */
const outline = (moves: ChessStudyMove[], depth = 0): string[] =>
	moves.flatMap((move) => [
		`${'  '.repeat(depth)}${move.san}`,
		...(move.variants ?? []).flatMap((variant) =>
			outline(variant.moves as ChessStudyMove[], depth + 1)
		),
	]);

describe('mergeStudies', () => {
	it('leaves a single study as it found it', () => {
		const merged = mergeStudies([study([mv('e4'), mv('e5')])], '0.0.6');

		assert.deepEqual(outline(merged.study.moves), ['e4', 'e5']);
		assert.equal(merged.skipped, 0);
		assert.equal(merged.dropped, 0);
	});

	it('adds nothing when the second study says the same thing', () => {
		const merged = mergeStudies(
			[study([mv('e4'), mv('e5')]), study([mv('e4'), mv('e5')])],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.study.moves), ['e4', 'e5']);
	});

	it('hangs a diverging line off the move it branches from', () => {
		const merged = mergeStudies(
			[
				study([mv('e4'), mv('e5'), mv('Nf3')]),
				study([mv('e4'), mv('e5'), mv('Nc3'), mv('Nf6')]),
			],
			'0.0.6'
		);

		// Nc3 is an alternative to Nf3, so it hangs off e5 - the move before it.
		assert.deepEqual(outline(merged.study.moves), [
			'e4',
			'e5',
			'  Nc3',
			'  Nf6',
			'Nf3',
		]);
	});

	it('keeps the first study as the mainline', () => {
		const merged = mergeStudies(
			[study([mv('e4'), mv('c5')]), study([mv('e4'), mv('e5')])],
			'0.0.6'
		);

		assert.equal(merged.study.moves[1].san, 'c5');
	});

	it("carries a grafted line's own variations with it", () => {
		const merged = mergeStudies(
			[
				study([mv('e4'), mv('e5')]),
				study([
					mv('e4'),
					mv('c5', { variants: [va([mv('e6'), mv('d4')])] }),
					mv('Nf3'),
				]),
			],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.study.moves), [
			'e4',
			'  c5',
			'    e6',
			'    d4',
			'  Nf3',
			'e5',
		]);
	});

	it('descends into a line both studies already share', () => {
		const merged = mergeStudies(
			[
				study([mv('e4'), mv('e5'), mv('Nf3'), mv('Nc6')]),
				study([mv('e4'), mv('e5'), mv('Nf3'), mv('Nf6')]),
			],
			'0.0.6'
		);

		assert.deepEqual(outline(merged.study.moves), [
			'e4',
			'e5',
			'Nf3',
			'  Nf6',
			'Nc6',
		]);
	});

	it('leaves out a study that starts from another position', () => {
		const merged = mergeStudies(
			[
				study([mv('e4')]),
				study([mv('Nf3')], { rootFEN: '8/8/4k3/8/8/4K3/8/8 w - - 0 1' }),
			],
			'0.0.6'
		);

		assert.equal(merged.skipped, 1);
		assert.deepEqual(outline(merged.study.moves), ['e4']);
	});

	it('counts an alternative first move it cannot hang anywhere', () => {
		const merged = mergeStudies(
			[study([mv('e4'), mv('e5')]), study([mv('d4'), mv('d5')])],
			'0.0.6'
		);

		assert.equal(merged.dropped, 1);
		assert.deepEqual(outline(merged.study.moves), ['e4', 'e5']);
	});

	it('fills in annotations the first study lacks without overwriting any', () => {
		const merged = mergeStudies(
			[
				study([mv('e4', { comment: 'mine' }), mv('e5')]),
				study([
					mv('e4', { comment: 'theirs', classification: 'Great' }),
					mv('e5', { comment: 'theirs', excluded: true }),
				]),
			],
			'0.0.6'
		);

		const [e4, e5] = merged.study.moves;

		assert.equal(e4.comment?.content?.[0].content?.[0].text, 'mine');
		assert.equal(e4.classification, 'Great');
		assert.equal(e5.comment?.content?.[0].content?.[0].text, 'theirs');
		assert.equal(e5.excluded, true);
	});

	it('never shares a move with the studies it was built from', () => {
		const source = study([mv('e4'), mv('e5')]);
		const merged = mergeStudies([source], '0.0.6');

		merged.study.moves[0].comment = null;
		merged.study.moves[0].variants.push(va([mv('c5')]));

		assert.equal(source.moves[0].variants.length, 0);
	});

	it('joins the titles and takes the first colour anyone recorded', () => {
		const merged = mergeStudies(
			[
				study([mv('e4')], { header: { title: 'Italian' } }),
				study([mv('e4')], { header: { title: 'Ruy' }, playerColor: 'b' }),
				study([mv('e4')], { header: { title: 'Italian' } }),
			],
			'0.0.6'
		);

		assert.equal(merged.study.header.title, 'Italian + Ruy');
		assert.equal(merged.study.playerColor, 'b');
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

	it('adds up what the same move was asked in two studies', () => {
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
