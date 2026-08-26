import { parseYaml } from 'obsidian';
import { ChessRepertoirePluginSettings } from 'src/components/obsidian/SettingsTab';

/**
 * A block's settings: the plugin's defaults with whatever the block's YAML
 * says on top. The YAML is hand-written, so it can carry keys this type does
 * not know about - `chessPosition` blocks use their own - and those arrive as
 * `unknown` for the reader to check.
 */
type ChessRepertoireAppConfig = ChessRepertoirePluginSettings & {
	chessRepertoireId: string;
} & Record<string, unknown>;

export const parseUserConfig = (
	settings: ChessRepertoirePluginSettings,
	content: string
): ChessRepertoireAppConfig => {
	const chessRepertoireConfig: ChessRepertoireAppConfig = {
		...settings,
		chessRepertoireId: '',
	};

	let parsed: unknown;

	try {
		parsed = parseYaml(content);
	} catch {
		throw Error('Something went wrong during parsing. :(');
	}

	return {
		...chessRepertoireConfig,
		...(parsed as Partial<ChessRepertoireAppConfig> | null),
	};
};
