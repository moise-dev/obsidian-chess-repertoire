import { Lightbulb, X } from 'lucide-react';
import * as React from 'react';
import { Trainer, TrainerStatus } from './useTrainer';

export { useTrainer } from './useTrainer';
export type { Trainer } from './useTrainer';

const STATUS_TEXT: Record<TrainerStatus, string> = {
	idle: '',
	'your-turn': 'Your move.',
	opponent: 'Playing the reply…',
	wrong: 'Not the move — try again.',
	complete: 'End of the line. Well done!',
};

/**
 * The drill's control strip. It takes the place of the notes panel while a
 * session runs, so the study cannot answer the question for you.
 */
export const TrainerBar = React.memo((props: Trainer) => {
	const {
		playerColor,
		status,
		errorCount,
		commentHint,
		hintsGiven,
		hintCount,
		requestHint,
		stop,
	} = props;

	return (
		<div className={`cs-trainer is-${status}`}>
			<div className="cs-trainer-row">
				<span className="cs-trainer-chip">
					Training as {playerColor === 'white' ? 'White' : 'Black'}
				</span>
				<span className="cs-trainer-status">{STATUS_TEXT[status]}</span>
				{errorCount > 0 && (
					<span
						className="cs-trainer-errors"
						title={`${errorCount} wrong ${
							errorCount === 1 ? 'move' : 'moves'
						} so far`}
					>
						{errorCount}
					</span>
				)}
				<button
					className="cs-trainer-button"
					onClick={requestHint}
					disabled={
						(status !== 'your-turn' && status !== 'wrong') || hintsGiven >= hintCount
					}
					title={
						hintsGiven >= hintCount
							? 'No more hints for this move'
							: 'Show the next hint'
					}
				>
					<Lightbulb size={14} />
					Hint
					{hintCount > 0 && (
						<span className="cs-trainer-hint-count">
							{Math.min(hintsGiven, hintCount)}/{hintCount}
						</span>
					)}
				</button>
				<button className="cs-trainer-button" onClick={stop} title="Stop training">
					<X size={14} />
					Stop
				</button>
			</div>
			{commentHint && <p className="cs-trainer-hint">{commentHint}</p>}
		</div>
	);
});

TrainerBar.displayName = 'TrainerBar';
