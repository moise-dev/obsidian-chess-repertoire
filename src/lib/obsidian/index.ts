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

/**
 * Only what the block's YAML says, without the plugin's defaults underneath:
 * for the settings where a value written in the block means something a
 * default does not.
 */
export const parseBlockConfig = (
	content: string
): Partial<ChessRepertoireAppConfig> => {
	let parsed: unknown;

	try {
		parsed = parseYaml(content);
	} catch {
		throw Error('Something went wrong during parsing. :(');
	}

	return (parsed as Partial<ChessRepertoireAppConfig> | null) ?? {};
};

export const parseUserConfig = (
	settings: ChessRepertoirePluginSettings,
	content: string
): ChessRepertoireAppConfig => ({
	...settings,
	chessRepertoireId: '',
	...parseBlockConfig(content),
});
