import { Check, Lightbulb, X } from 'lucide-react';
import * as React from 'react';
import { Trainer, TrainerReport, TrainerStatus } from './useTrainer';

export { useTrainer } from './useTrainer';
export type { Trainer, TrainerReport } from './useTrainer';

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

interface TrainerReportPanelProps {
	report: TrainerReport;
	onDismiss: () => void;
}

/**
 * What the session found, once it is over.
 *
 * Only the mistakes are listed. A drill you got right needs no reading back;
 * what is worth keeping is the handful of positions where the study said one
 * thing and you played another.
 */
export const TrainerReportPanel = React.memo(
	({ report, onDismiss }: TrainerReportPanelProps) => {
		const { completed, movesPlayed, mistakes } = report;
		const total = mistakes.reduce((sum, mistake) => sum + mistake.count, 0);

		const summary = [
			`${movesPlayed} ${movesPlayed === 1 ? 'move' : 'moves'} played`,
			total === 0
				? 'no mistakes'
				: `${total} ${total === 1 ? 'mistake' : 'mistakes'}`,
		].join(', ');

		return (
			<div className={`cs-trainer${total ? '' : ' is-clean'}`}>
				<div className="cs-trainer-row">
					<span className="cs-trainer-chip">
						{completed ? 'Line complete' : 'Session stopped'}
					</span>
					<span className="cs-trainer-status">{summary}.</span>
					<button
						className="cs-trainer-button"
						onClick={onDismiss}
						title="Close the report"
					>
						<X size={14} />
						Close
					</button>
				</div>

				{total === 0 ? (
					<p className="cs-trainer-clean">
						<Check size={14} />
						Every move matched the study.
					</p>
				) : (
					<ul className="cs-trainer-mistakes">
						{mistakes.map((mistake) => (
							<li
								className="cs-trainer-mistake"
								key={`${mistake.atMoveId ?? 'root'}-${mistake.played}`}
							>
								<span className="cs-trainer-mistake-label">{mistake.label}</span>
								<span className="cs-trainer-mistake-played">{mistake.played}</span>
								{mistake.count > 1 && (
									<span className="cs-trainer-mistake-count">×{mistake.count}</span>
								)}
								<span className="cs-trainer-mistake-arrow">→</span>
								<span className="cs-trainer-mistake-expected">{mistake.expected}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		);
	}
);

TrainerReportPanel.displayName = 'TrainerReportPanel';
