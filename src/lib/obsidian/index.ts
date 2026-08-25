import { parseYaml } from 'obsidian';
import { ChessRepertoirePluginSettings } from 'src/components/obsidian/SettingsTab';

type ChessRepertoireAppConfig = ChessRepertoirePluginSettings & {
	chessRepertoireId: string;
};

export const parseUserConfig = (
	settings: ChessRepertoirePluginSettings,
	content: string
): ChessRepertoireAppConfig => {
	const chessRepertoireConfig: ChessRepertoireAppConfig = {
		...settings,
		chessRepertoireId: '',
	};

	try {
		return {
			...chessRepertoireConfig,
			...parseYaml(content),
		};
	} catch (e) {
		throw Error('Something went wrong during parsing. :(');
	}
};
