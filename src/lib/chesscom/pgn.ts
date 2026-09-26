import { parsePgn, titleFromHeaders } from 'src/lib/pgn';
import { ChessRepertoireFileData, ChessRepertoireMove } from 'src/lib/storage';
import { ChessComGameRecord } from './types';

const parseDate = (value: string | undefined): Date | null => {
	const match = value?.match(/^(\d{4})[./-](\d{2})[./-](\d{2})/);
	if (!match) return null;

	const date = new Date(
		Number(match[1]),
		Number(match[2]) - 1,
		Number(match[3])
	);
	return Number.isNaN(date.getTime()) ? null : date;
};

const playerName = (value: unknown, fallback: string): string => {
	if (typeof value === 'string' && value.trim()) {
		const parts = value.split('/');
		return parts[parts.length - 1] || fallback;
	}

	if (
		value &&
		typeof value === 'object' &&
		'username' in value &&
		typeof value.username === 'string'
	)
		return value.username;

	return fallback;
};

const stringValue = (value: unknown, fallback = ''): string =>
	typeof value === 'string' ? value : fallback;

const playerColor = (
	white: string,
	black: string,
	username: string
): 'w' | 'b' | null => {
	const target = username.trim().toLowerCase();
	if (white.trim().toLowerCase() === target) return 'w';
	if (black.trim().toLowerCase() === target) return 'b';
	return null;
};

const playerResult = (
	result: string,
	color: 'w' | 'b' | null
): 'win' | 'loss' | 'draw' | null => {
	if (!color || result === '*') return null;
	if (result === '1/2-1/2') return 'draw';

	const whiteWon = result === '1-0';
	return (color === 'w') === whiteWon ? 'win' : 'loss';
};

export const analysisUrl = (url: string): string | null => {
	if (!url) return null;
	if (url.includes('/analysis/game/'))
		return url.includes('tab=review')
			? url
			: `${url}${url.includes('?') ? '&' : '?'}tab=review`;
	if (url.includes('/analysis/')) return url;

	const match = url.match(/\/game\/([^/]+)\/(\d+)(?:\/?(?:[?#].*)?)$/);
	return match
		? `https://www.chess.com/analysis/game/${match[1]}/${match[2]}?tab=review`
		: url;
};

export const gameDate = (
	rawGame: Record<string, unknown>,
	headers: Record<string, string>
): Date => {
	const endTime = Number(rawGame.end_time);
	const endDate = new Date(endTime * 1000);
	if (endTime > 0 && !Number.isNaN(endDate.getTime())) return endDate;

	return (
		parseDate(headers.EndDate) ||
		parseDate(headers.UTCDate) ||
		parseDate(headers.Date) ||
		new Date(Number(rawGame.start_time || 0) * 1000 || Date.now())
	);
};

export const parseGame = (
	rawGame: Record<string, unknown>,
	username: string
): ChessComGameRecord | null => {
	const pgn = typeof rawGame.pgn === 'string' ? rawGame.pgn.trim() : '';
	if (!pgn) return null;

	const headers = parseHeaders(pgn);
	const white = playerName(rawGame.white, headers.White || 'White');
	const black = playerName(rawGame.black, headers.Black || 'Black');
	const result = headers.Result || '*';
	const url = (headers.Link || stringValue(rawGame.url)).trim();
	const key = url || `pgn-${hashString(pgn)}`;
	const rules = stringValue(
		rawGame.rules,
		headers.Variant || 'chess'
	).toLowerCase();
	let moveIndex = 0;
	const parsed = parsePgn(
		pgn,
		headers.FEN || ROOT_FEN,
		() => `${hashString(key)}-${String(moveIndex++).padStart(4, '0')}`
	);
	const color = playerColor(white, black, username);

	return {
		key,
		pgn,
		headers,
		white,
		black,
		result,
		url,
		analysisUrl: analysisUrl(url),
		rules,
		timeClass: stringValue(rawGame.time_class, headers.TimeClass || ''),
		timeControl: stringValue(rawGame.time_control, headers.TimeControl || ''),
		eco: stringValue(rawGame.eco, headers.ECO || ''),
		accuracies: (() => {
			const value = rawGame.accuracies;
			if (!value || typeof value !== 'object') return {};
			const record = value as Record<string, unknown>;
			return {
				white: typeof record.white === 'number' ? record.white : undefined,
				black: typeof record.black === 'number' ? record.black : undefined,
			};
		})(),
		ratings: (() => {
			const white = Number(headers.WhiteElo);
			const black = Number(headers.BlackElo);
			return {
				white: Number.isFinite(white) ? white : undefined,
				black: Number.isFinite(black) ? black : undefined,
			};
		})(),
		date: gameDate(rawGame, headers),
		parsed,
		playerColor: color,
		playerResult: playerResult(result, color),
	};
};

export const parseHeaders = (pgn: string): Record<string, string> => {
	const headers: Record<string, string> = {};
	const pattern = /^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"])*)"\]\s*$/gm;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(pgn)))
		headers[match[1]] = match[2].replace(/\\([\\"])/g, '$1');

	return headers;
};

export const repertoireFromGame = (
	game: ChessComGameRecord,
	id: string
): ChessRepertoireFileData => ({
	version: '0.0.7',
	header: { title: titleFromHeaders(game.headers) },
	moves: game.parsed.moves.map((move, index) => ({
		...move,
		moveId: move.moveId || `${id}-${String(index + 1).padStart(4, '0')}`,
	})),
	rootVariants: game.parsed.rootVariants,
	rootFEN: game.parsed.rootFEN,
	playerColor: game.playerColor ?? undefined,
});

export interface RepertoireMatch {
	id: string;
	title: string;
	length: number;
	line: string[];
}

const sameMove = (
	first: ChessRepertoireMove | undefined,
	second: ChessRepertoireMove
): boolean =>
	Boolean(first) &&
	(first!.lan && second.lan
		? first!.lan === second.lan
		: first!.san === second.san);

export const findBestRepertoireMatch = (
	gameMoves: ChessRepertoireMove[],
	entries: Array<{ id: string; repertoire: ChessRepertoireFileData }>
): RepertoireMatch | null => {
	let best: RepertoireMatch | null = null;

	const consider = (
		entry: { id: string; repertoire: ChessRepertoireFileData },
		length: number,
		line: string[]
	) => {
		if (!best || length > best.length)
			best = {
				id: entry.id,
				title: entry.repertoire.header.title || entry.id,
				length,
				line,
			};
	};

	const walk = (
		entry: { id: string; repertoire: ChessRepertoireFileData },
		nodes: ChessRepertoireMove[],
		index: number,
		line: string[]
	) => {
		let currentIndex = index;
		let currentLine = line;
		for (const node of nodes) {
			if (!sameMove(gameMoves[currentIndex], node)) break;
			currentIndex++;
			currentLine = [...currentLine, node.san];
			consider(entry, currentIndex, currentLine);
			for (const variant of node.variants || [])
				walk(entry, variant.moves, currentIndex, currentLine);
		}
	};

	for (const entry of entries) {
		if (entry.id.startsWith('chesscom-')) continue;
		walk(entry, entry.repertoire.moves, 0, []);
		for (const variant of entry.repertoire.rootVariants || [])
			walk(entry, variant.moves, 0, []);
	}

	return best;
};

export const hashString = (value: string): string => {
	let hash = 2166136261;
	for (const character of value) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
};

export const ROOT_FEN =
	'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
