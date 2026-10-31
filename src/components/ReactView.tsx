import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Platform,
} from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import {
	ChessRepertoireDataAdapter,
	ChessRepertoireFileData,
} from 'src/lib/storage';
import { ChessRepertoirePluginSettings } from './obsidian/SettingsTab';
import { ChessRepertoire } from './react/ChessRepertoire';

export class ReactView extends MarkdownRenderChild {
	root: ReactDOM.Root;
	source: string;
	app: App;
	ctx: MarkdownPostProcessorContext;
	settings: ChessRepertoirePluginSettings;
	data: ChessRepertoireFileData;
	dataAdapter: ChessRepertoireDataAdapter;

	constructor(
		containerEL: HTMLElement,
		source: string,
		app: App,
		ctx: MarkdownPostProcessorContext,
		settings: ChessRepertoirePluginSettings,
		data: ChessRepertoireFileData,
		dataAdapter: ChessRepertoireDataAdapter
	) {
		super(containerEL);
		this.source = source;
		this.app = app;
		this.ctx = ctx;
		this.settings = settings;
		this.data = data;
		this.dataAdapter = dataAdapter;
	}

	onload() {
		this.root = ReactDOM.createRoot(this.containerEl);
		this.root.render(
			<React.StrictMode>
				<ChessRepertoire
					source={this.source}
					app={this.app}
					ctx={this.ctx}
					containerEl={this.containerEl}
					pluginSettings={this.settings}
					chessRepertoireData={this.data}
					dataAdapter={this.dataAdapter}
					// `isMobile` rather than `isMobileApp`, which stays false under
					// `app.emulateMobile(true)`: the desktop's emulation should run
					// the same read-only path a phone does.
					isMobile={Platform.isMobile}
				/>
			</React.StrictMode>
		);
	}

	onunload() {
		this.root.unmount();
	}
}
