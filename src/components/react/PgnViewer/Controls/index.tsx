import {
	ArrowLeft,
	ArrowRight,
	ChevronsLeft,
	ChevronsRight,
	Copy,
	FlipVertical2,
	GraduationCap,
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
	onUndoButtonClick: () => void;
	onFirstButtonClick: () => void;
	onBackButtonClick: () => void;
	onForwardButtonClick: () => void;
	onLastButtonClick: () => void;
	onFlipButtonClick: () => void;
	onSaveButtonClick: () => void;
	onCopyButtonClick: () => void;
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
				<ChevronsLeft size={18} />
			</button>
			<button
				className="cs-icon-button"
				title="Previous move"
				aria-label="Go to the previous move"
				onClick={() => props.onBackButtonClick()}
			>
				<ArrowLeft size={18} />
			</button>
			<button
				className="cs-icon-button"
				title="Next move"
				aria-label="Go to the next move"
				onClick={() => props.onForwardButtonClick()}
			>
				<ArrowRight size={18} />
			</button>
			<button
				className="cs-icon-button"
				title="Last move"
				aria-label="Go to the last move"
				onClick={() => props.onLastButtonClick()}
			>
				<ChevronsRight size={18} />
			</button>

			<span className="cs-controls-divider" />

			<button
				className="cs-icon-button"
				title="Flip board"
				aria-label="Flip the board"
				onClick={() => props.onFlipButtonClick()}
			>
				<FlipVertical2 size={18} />
			</button>
			<button
				className={`cs-icon-button${props.isTraining ? ' is-active' : ''}`}
				title={props.isTraining ? 'Stop training' : 'Train this position'}
				aria-label="Train this position"
				aria-pressed={props.isTraining}
				onClick={() => props.onTrainButtonClick()}
			>
				<GraduationCap size={18} />
			</button>
			<button
				className="cs-icon-button"
				title="Undo last move"
				aria-label="Undo the last move"
				disabled={props.isTraining}
				onClick={() => props.onUndoButtonClick()}
			>
				<Undo2 size={18} />
			</button>
			<button
				className="cs-icon-button"
				title="Copy FEN"
				aria-label="Copy the current position as FEN"
				onClick={() => props.onCopyButtonClick()}
			>
				<Copy size={18} />
			</button>
			<button
				className={`cs-icon-button cs-icon-button--primary${
					props.isDirty ? ' is-dirty' : ''
				}`}
				title={props.isDirty ? 'Save study (unsaved changes)' : 'Save study'}
				aria-label="Save the study"
				onClick={() => props.onSaveButtonClick()}
			>
				<Save size={18} />
			</button>
		</div>
	);
};
