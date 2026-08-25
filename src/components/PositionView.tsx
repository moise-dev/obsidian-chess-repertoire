import { App, MarkdownRenderChild } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ChessStudyPluginSettings } from './obsidian/SettingsTab';
import { MiniBoard } from './react/MiniBoard';

export interface PositionConfig {
	fen: string;
	orientation: 'white' | 'black';
	size: number | null;
}

/**
 * A lone position, with none of a study's machinery: no moves, no notes, no
 * storage file. `size` left out lets it fill the width it is given, which is
 * what a canvas card wants.
 */
export class PositionView extends MarkdownRenderChild {
	private root: ReactDOM.Root | null = null;

	constructor(
		containerEl: HTMLElement,
		private app: App,
		private settings: ChessStudyPluginSettings,
		private config: PositionConfig
	) {
		super(containerEl);
	}

	onload() {
		this.root = ReactDOM.createRoot(this.containerEl);
		this.root.render(
			<div className="cs-position">
				<MiniBoard
					fen={this.config.fen}
					flipped={this.config.orientation === 'black'}
					boardColor={this.settings.boardColor}
					size={this.config.size ?? undefined}
				/>
			</div>
		);
	}

	onunload() {
		this.root?.unmount();
		this.root = null;
	}
}
