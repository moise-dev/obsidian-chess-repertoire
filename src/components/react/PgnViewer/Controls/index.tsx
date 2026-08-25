import {
	ArrowLeft,
	ArrowRight,
	ChevronsLeft,
	ChevronsRight,
	Download,
	FlipVertical2,
	GraduationCap,
	Network,
	Save,
	Undo2,
} from 'lucide-react';
import * as React from 'react';

export interface ControlActions {
	/** Unsaved changes exist. Nothing is lost - autosave is debounced - but the
	 *  save button shows it so the state is never invisible. */
	isDirty: boolean;
	/** A training session is running; the study is read-only while it is. */
	isTraining: boolean;
	onTrainButtonClick: () => void;
	onMapButtonClick: () => void;
	onUndoButtonClick: () => void;
	onFirstButtonClick: () => void;
	onBackButtonClick: () => void;
	onForwardButtonClick: () => void;
	onLastButtonClick: () => void;
	onFlipButtonClick: () => void;
	onSaveButtonClick: () => void;
	onExportButtonClick: () => void;
}

export const Controls = (props: ControlActions) => {
	return (
		<div className="cs-controls">
			<button
				className="cs-icon-button"
				title="Start position"
				aria-label="Go to the start position"
				onClick={() => props.onFirstButtonClick()}
			>
				<ChevronsLeft size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Previous move"
				aria-label="Go to the previous move"
				onClick={() => props.onBackButtonClick()}
			>
				<ArrowLeft size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Next move"
				aria-label="Go to the next move"
				onClick={() => props.onForwardButtonClick()}
			>
				<ArrowRight size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Last move"
				aria-label="Go to the last move"
				onClick={() => props.onLastButtonClick()}
			>
				<ChevronsRight size={22} />
			</button>

			<span className="cs-controls-divider" />

			<button
				className="cs-icon-button"
				title="Flip board"
				aria-label="Flip the board"
				onClick={() => props.onFlipButtonClick()}
			>
				<FlipVertical2 size={22} />
			</button>
			<button
				className={`cs-icon-button${props.isTraining ? ' is-active' : ''}`}
				title={props.isTraining ? 'Stop training' : 'Train this study'}
				aria-label="Train this study from its first move"
				aria-pressed={props.isTraining}
				onClick={() => props.onTrainButtonClick()}
			>
				<GraduationCap size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Open the study map"
				aria-label="Open the study map"
				onClick={() => props.onMapButtonClick()}
			>
				<Network size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Undo last move"
				aria-label="Undo the last move"
				disabled={props.isTraining}
				onClick={() => props.onUndoButtonClick()}
			>
				<Undo2 size={22} />
			</button>
			<button
				className="cs-icon-button"
				title="Export study"
				aria-label="Export the study as PGN or FEN"
				onClick={() => props.onExportButtonClick()}
			>
				<Download size={22} />
			</button>
			<button
				className={`cs-icon-button cs-icon-button--primary${
					props.isDirty ? ' is-dirty' : ''
				}`}
				title={props.isDirty ? 'Save study (unsaved changes)' : 'Save study'}
				aria-label="Save the study"
				onClick={() => props.onSaveButtonClick()}
			>
				<Save size={22} />
			</button>
		</div>
	);
};
