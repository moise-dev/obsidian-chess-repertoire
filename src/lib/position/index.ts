import { Chess } from 'chess.js';
import { PositionConfig } from 'src/components/PositionView';
import { ChessRepertoirePluginSettings } from 'src/components/obsidian/SettingsTab';
import { parseUserConfig } from 'src/lib/obsidian';

/**
 * The settings of a `chessPosition` block, or null when it names no position
 * that can be put on a board.
 *
 * The FEN is validated here rather than trusted: a hand-written block is the
 * likeliest place for a broken one, and a board drawn from nonsense is worse
 * than a line saying so.
 */
export const parsePositionConfig = (
	settings: ChessRepertoirePluginSettings,
	source: string
): PositionConfig | null => {
	let parsed;

	try {
		parsed = parseUserConfig(settings, source);
	} catch {
		return null;
	}

	const fen = typeof parsed.fen === 'string' ? parsed.fen.trim() : '';

	if (!fen) return null;

	try {
		new Chess(fen);
	} catch {
		return null;
	}

	return {
		fen,
		orientation: parsed.orientation === 'black' ? 'black' : 'white',
		size: typeof parsed.size === 'number' ? parsed.size : null,
	};
};
