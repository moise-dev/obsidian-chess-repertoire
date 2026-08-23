import { App, MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ChessStudyDataAdapter, ChessStudyFileData } from 'src/lib/storage';
import { ChessStudyPluginSettings } from './obsidian/SettingsTab';
import { ChessStudy } from './react/ChessStudy';

export class ReactView extends MarkdownRenderChild {
	root: ReactDOM.Root;
	source: string;
	app: App;
	ctx: MarkdownPostProcessorContext;
	settings: ChessStudyPluginSettings;
	data: ChessStudyFileData;
	dataAdapter: ChessStudyDataAdapter;

	constructor(
		containerEL: HTMLElement,
		source: string,
		app: App,
		ctx: MarkdownPostProcessorContext,
		settings: ChessStudyPluginSettings,
		data: ChessStudyFileData,
		dataAdapter: ChessStudyDataAdapter
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
				<ChessStudy
					source={this.source}
					app={this.app}
					ctx={this.ctx}
					containerEl={this.containerEl}
					pluginSettings={this.settings}
					chessStudyData={this.data}
					dataAdapter={this.dataAdapter}
				/>
			</React.StrictMode>
		);
	}

	onunload() {
		this.root.unmount();
	}
}
