import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import {
	createSourceFile,
	isClassDeclaration,
	ScriptKind,
	ScriptTarget,
	transpileModule,
} from 'typescript';
import {
	archiveUrlForMonth,
	dayBefore,
	dayKey,
	shouldFetchArchive,
	shouldImportGame,
} from '../src/lib/chesscom/fetch';
import { managedSection, mergeManagedSection } from '../src/lib/chesscom/notes';
import {
	findBestRepertoireMatch,
	gameDate,
	parseGame,
} from '../src/lib/chesscom/pgn';

const pgn = [
	'[White "m42e_de"]',
	'[Black "Opponent"]',
	'[Result "1-0"]',
	'[Link "https://www.chess.com/game/daily/123"]',
	'',
	'1. e4 e5 2. Nf3 Nc6 1-0',
].join('\n');

describe('Chess.com integration', () => {
	it('advances the checkpoint only after a successful import and leaves failures retryable', async () => {
		const source = createSourceFile(
			'main.tsx',
			readFileSync('src/main.tsx', 'utf8'),
			ScriptTarget.Latest,
			true,
			ScriptKind.TSX
		);
		const pluginClass = source.statements.find(isClassDeclaration)!;
		const method = pluginClass.members.find(
			(member) => member.name?.getText(source) === 'importChessComGames'
		)!;
		const { outputText } = transpileModule(
			`class ImportProbe { ${method.getText(source)} }`,
			{ compilerOptions: { target: ScriptTarget.ES2022 } }
		);
		const importGames = runInNewContext(
			`${outputText}; ImportProbe.prototype.importChessComGames`,
			{
				dayKey,
				dayBefore,
				parseGame,
				shouldImportGame,
				findBestRepertoireMatch,
				console: { info() {}, warn() {}, error() {} },
				Notice: class {},
			}
		) as (this: unknown) => Promise<void>;

		for (const failure of [
			'fetch',
			'load',
			'board',
			'note',
			'save',
			'none',
			'empty',
		]) {
			const calls: string[] = [];
			let persistedDay = '2026-09-01';
			const step = (name: string) => {
				calls.push(name);
				if (name === failure) throw new Error(`Failed ${name}`);
			};
			const plugin = {
				importInProgress: false,
				settings: {
					chessComUsername: 'm42e_de',
					chessComArchiveMonths: 1,
					chessComLastFetchedDay: persistedDay,
				},
				fetchChessComGames() {
					step('fetch');
					return failure === 'empty'
						? []
						: [{ pgn, end_time: new Date(2026, 8, 21, 12).getTime() / 1000 }];
				},
				loadedRepertoires() {
					step('load');
					return [];
				},
				writeChessComBoard: () => step('board'),
				dailyNotePath: () => '2026-09-21.md',
				updateChessComDailyNote: () => step('note'),
				saveSettings() {
					step('save');
					persistedDay = this.settings.chessComLastFetchedDay;
				},
			};

			await importGames.call(plugin);

			const expectedDay = ['none', 'empty'].includes(failure)
				? dayKey(new Date())
				: '2026-09-01';
			assert.equal(persistedDay, expectedDay, failure);
			assert.equal(plugin.settings.chessComLastFetchedDay, expectedDay, failure);
			assert.equal(plugin.importInProgress, false, failure);
			if (failure === 'none')
				assert.deepEqual(calls, ['fetch', 'load', 'board', 'note', 'save']);
			if (failure === 'empty') assert.deepEqual(calls, ['fetch', 'load', 'save']);
		}
	});

	it('imports daily games by completion time rather than their PGN start date', () => {
		const completed = new Date(2026, 8, 21, 0, 30);
		const game = parseGame(
			{
				pgn: `[UTCDate "2026.09.01"]\n[EndDate "2026.09.20"]\n${pgn}`,
				end_time: completed.getTime() / 1000,
			},
			'm42e_de'
		)!;

		assert.equal(game.date.getTime(), completed.getTime());
		assert.equal(dayKey(game.date), '2026-09-21');
		assert.equal(shouldImportGame(game.date, dayBefore('2026-09-20')), true);
	});

	it('uses the completion date from pasted PGNs without an archive timestamp', () => {
		assert.equal(
			dayKey(gameDate({}, { UTCDate: '2026.09.01', EndDate: '2026.09.21' })),
			'2026-09-21'
		);
	});

	it('falls back to the PGN date when the completion timestamp is invalid', () => {
		for (const endTime of [undefined, 0, 'invalid', Infinity]) {
			assert.equal(
				dayKey(gameDate({ end_time: endTime }, { UTCDate: '2026.09.01' })),
				'2026-09-01'
			);
		}
	});

	it('does not fetch days older than the previous fetch day', () => {
		const lastFetchedDay = '2026-09-21';
		const currentMonthArchive = archiveUrlForMonth(
			'test user',
			new Date(2026, 8, 21)
		);

		assert.equal(
			shouldFetchArchive(
				'https://api.chess.com/pub/player/test/games/2026/08',
				lastFetchedDay
			),
			false
		);
		assert.equal(
			shouldFetchArchive(
				'https://api.chess.com/pub/player/test/games/2026/09',
				lastFetchedDay
			),
			true
		);
		assert.equal(
			currentMonthArchive,
			'https://api.chess.com/pub/player/test%20user/games/2026/09'
		);
		assert.equal(
			shouldFetchArchive(currentMonthArchive, dayBefore(lastFetchedDay)),
			true
		);
		assert.equal(shouldImportGame(new Date(2026, 8, 20), lastFetchedDay), false);
		assert.equal(shouldImportGame(new Date(2026, 8, 21), lastFetchedDay), true);
		assert.equal(dayBefore(lastFetchedDay), '2026-09-20');
		assert.equal(
			shouldImportGame(new Date(2026, 8, 20), dayBefore(lastFetchedDay)),
			true
		);
	});

	it('keeps existing imported games when a later import adds games', () => {
		const first = parseGame(
			{ pgn, url: 'https://www.chess.com/game/daily/123', rules: 'chess' },
			'm42e_de'
		)!;
		const second = parseGame(
			{
				pgn: pgn.replace('daily/123', 'daily/456').replace('1. e4 e5', '1. d4 d5'),
				url: 'https://www.chess.com/game/daily/456',
				rules: 'chess',
			},
			'm42e_de'
		)!;
		const settings = {
			includePgn: true,
			includeAnalysis: true,
			includeBoards: false,
		};
		const existing = managedSection([first], settings).replace(
			'- **Result:** 1-0',
			'- **Result:** 1-0\n- **Personal note:** keep this'
		);
		assert.equal(
			existing.split('\n').find((line) => line.startsWith('### ')),
			'### m42e_de vs Opponent - 1-0'
		);

		const merged = mergeManagedSection(existing, [second], settings);

		assert.match(merged, /Personal note.*keep this/);
		assert.equal((merged.match(/^### /gm) || []).length, 2);
		assert.equal(mergeManagedSection(merged, [first, second], settings), merged);
	});

	it('normalises a public Chess.com PGN into the native repertoire move shape', () => {
		const game = parseGame(
			{ pgn, url: 'https://www.chess.com/game/daily/123', rules: 'chess' },
			'm42e_de'
		);

		assert.ok(game);
		assert.equal(game.playerColor, 'w');
		assert.equal(game.playerResult, 'win');
		assert.equal(game.parsed.skipped, 0);
		assert.deepEqual(
			game.parsed.moves.map((move) => move.san),
			['e4', 'e5', 'Nf3', 'Nc6']
		);
		assert.equal(
			game.analysisUrl,
			'https://www.chess.com/analysis/game/daily/123?tab=review'
		);
	});

	it('uses the PGN game link when the archive URL is stale', () => {
		const canonicalUrl = 'https://www.chess.com/game/daily/789';
		const game = parseGame(
			{
				pgn: pgn.replace('https://www.chess.com/game/daily/123', canonicalUrl),
				url: 'https://www.chess.com/game/daily/246444568',
				rules: 'chess',
			},
			'm42e_de'
		);

		assert.ok(game);
		assert.equal(game.url, canonicalUrl);
		assert.equal(game.key, canonicalUrl);
		assert.equal(
			game.analysisUrl,
			'https://www.chess.com/analysis/game/daily/789?tab=review'
		);
	});

	it('recognises Chess.com computer-game links in pasted PGNs', () => {
		const game = parseGame(
			{
				pgn: pgn.replace(
					'https://www.chess.com/game/daily/123',
					'https://www.chess.com/game/computer/123'
				),
				url: 'https://www.chess.com/game/computer/123',
				rules: 'chess',
			},
			'm42e_de'
		);

		assert.ok(game);
		assert.equal(
			game.analysisUrl,
			'https://www.chess.com/analysis/game/computer/123?tab=review'
		);
	});
});
