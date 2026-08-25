import { App, Modal } from 'obsidian';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { MoveMap } from 'src/components/react/MoveMap';
import { ChessStudyMove, MoveDrillStats } from 'src/lib/storage';

export interface MoveMapModalOptions {
	moves: ChessStudyMove[];
	rootFEN: string;
	title: string | null;
	currentMoveId: string | null;
	firstPlayer: string;
	initialMoveNumber: number;
	userColor: 'w' | 'b';
	loadStats: () => Promise<Record<string, MoveDrillStats>>;
	onSelectMove: (moveId: string) => void;
}

/**
 * Hosts the map in a modal of its own.
 *
 * A modal rather than a workspace leaf because the map is only useful next to
 * the study it belongs to: choosing a move has to move that board, and a leaf
 * would need a registry to find its way back to the right one. It also takes
 * the keyboard with it, which the widget itself cannot do inside CodeMirror.
 *
 * Choosing a move closes it. The board it moves is behind the modal, so leaving
 * it open would hide the thing that just happened.
 */
export class MoveMapModal extends Modal {
	private root: ReactDOM.Root | null = null;

	constructor(app: App, private options: MoveMapModalOptions) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('cs-map-modal');

		this.root = ReactDOM.createRoot(this.contentEl);
		this.root.render(
			<MoveMap
				{...this.options}
				onSelectMove={(moveId) => {
					this.close();
					this.options.onSelectMove(moveId);
				}}
			/>
		);
	}

	onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.empty();
	}
}
