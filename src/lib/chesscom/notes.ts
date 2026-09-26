import { hashString } from './pgn';
import { ChessComGameRecord } from './types';

export const START_MARKER = '<!-- chess-com-daily:start -->';
export const END_MARKER = '<!-- chess-com-daily:end -->';

const escapeHeading = (value: string): string =>
	value.replace(/[\r\n#]/g, ' ').trim();

const accuracy = (value: unknown): string | null => {
	const number = Number(value);
	return Number.isFinite(number) ? `${number.toFixed(1)}%` : null;
};
const cell = (value: unknown): string => {
	const text =
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
			? `${value}`
			: '';
	return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
};

export const analysisMarkdown = (game: ChessComGameRecord): string => {
	const parts: string[] = [];
	const whiteAccuracy = accuracy(game.accuracies.white);
	const blackAccuracy = accuracy(game.accuracies.black);
	if (whiteAccuracy) parts.push(`White accuracy ${whiteAccuracy}`);
	if (blackAccuracy) parts.push(`Black accuracy ${blackAccuracy}`);
	if (Number.isFinite(game.ratings.white) || Number.isFinite(game.ratings.black))
		parts.push(
			`Chess.com rating: White ${game.ratings.white ?? 'n/a'}, Black ${
				game.ratings.black ?? 'n/a'
			}`
		);
	if (game.analysisUrl)
		parts.push(`[Open Chess.com analysis](${game.analysisUrl})`);
	if (!parts.length) parts.push('No analysis data available');

	return `- **Analysis:** ${parts.join('; ')}`;
};

export const gameMarkdown = (
	game: ChessComGameRecord,
	settings: {
		includePgn: boolean;
		includeAnalysis: boolean;
		includeBoards: boolean;
	}
): string => {
	const lines = [
		`### ${escapeHeading(game.white)} vs ${escapeHeading(game.black)} - ${
			game.result
		}`,
		`<!-- chess-com-game:${encodeURIComponent(game.key)} -->`,
		`- **Your color:** ${
			game.playerColor === 'w'
				? 'White'
				: game.playerColor === 'b'
				? 'Black'
				: 'Could not match username'
		}`,
		`- **Result:** ${game.result}${
			game.playerResult ? ` (${game.playerResult})` : ''
		}`,
	];
	if (game.timeClass || game.timeControl)
		lines.push(
			`- **Time:** ${[game.timeClass, game.timeControl]
				.filter(Boolean)
				.join(' / ')}`
		);
	if (game.eco) lines.push(`- **Opening:** \`${cell(game.eco)}\``);
	if (game.url) lines.push(`- **Game:** [View on Chess.com](${game.url})`);
	if (game.repertoireMatch)
		lines.push(
			`- **Repertoire:** [[${game.repertoireMatch.id}|${cell(
				game.repertoireMatch.title
			)}]] (${game.repertoireMatch.length} moves matched: ${cell(
				game.repertoireMatch.line.join(' ')
			)})`
		);
	if (settings.includeAnalysis)
		lines.push(
			`- **Analysis:** ${analysisMarkdown(game).replace(
				/^- \*\*Analysis:\*\* /,
				''
			)}`
		);
	if (settings.includePgn)
		lines.push(
			'',
			'<details>',
			'<summary>PGN</summary>',
			'',
			'````pgn',
			game.pgn,
			'````',
			'',
			'</details>'
		);
	if (settings.includeBoards && game.boardId)
		lines.push(
			'',
			'```chessRepertoire',
			`chessRepertoireId: ${game.boardId}`,
			'```'
		);
	return lines.join('\n');
};

export const managedSection = (
	games: ChessComGameRecord[],
	settings: {
		includePgn: boolean;
		includeAnalysis: boolean;
		includeBoards: boolean;
	}
): string =>
	[
		START_MARKER,
		'## Chess.com games',
		'',
		...games
			.sort((first, second) => first.key.localeCompare(second.key))
			.flatMap((game) => [gameMarkdown(game, settings), '']),
		END_MARKER,
	]
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');

export const pgnFromBlock = (block: string): string | null =>
	block.match(/`{4}pgn\r?\n([\s\S]*?)\r?\n`{4}/)?.[1].trim() ?? null;

const gameKeyFromBlock = (block: string): string | null => {
	const marker = block.match(/<!-- chess-com-game:([^>]+) -->/)?.[1];
	if (marker !== undefined) {
		try {
			return decodeURIComponent(marker);
		} catch {
			return null;
		}
	}

	const url = block.match(/^- \*\*Game:\*\* \[[^\]]*\]\(([^)]+)\)/m)?.[1];
	if (url) return url;

	const pgn = pgnFromBlock(block);
	return pgn ? `pgn-${hashString(pgn)}` : null;
};

const gameBlocksInSection = (section: string): string[] => {
	const end = section.indexOf(END_MARKER);
	const lines = section.slice(0, end < 0 ? section.length : end).split('\n');
	const starts = lines.reduce<number[]>(
		(indices, line, index) =>
			/^###\s+/.test(line) ? [...indices, index] : indices,
		[]
	);

	return starts.map((start, index) =>
		lines
			.slice(start, starts[index + 1] ?? lines.length)
			.join('\n')
			.trim()
	);
};

export const mergeManagedSection = (
	existingSection: string,
	games: ChessComGameRecord[],
	settings: {
		includePgn: boolean;
		includeAnalysis: boolean;
		includeBoards: boolean;
	}
): string => {
	const end = existingSection.indexOf(END_MARKER);
	if (end < 0) return managedSection(games, settings);

	const existingKeys = new Set(
		gameBlocksInSection(existingSection)
			.map(gameKeyFromBlock)
			.filter((key): key is string => key !== null)
	);
	const additions = games
		.filter((game) => !existingKeys.has(game.key))
		.sort((first, second) => first.key.localeCompare(second.key));

	if (!additions.length) return existingSection;

	return `${existingSection.slice(0, end).trimEnd()}\n\n${additions
		.map((game) => gameMarkdown(game, settings))
		.join('\n\n')}\n${existingSection.slice(end)}`;
};
