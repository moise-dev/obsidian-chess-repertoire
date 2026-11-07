import { nanoid } from 'nanoid';
import * as React from 'react';
import { useEffect, useState } from 'react';
import {
	Evaluation,
	EVALUATION_DEPTH,
	formatBarLabel,
	formatEvaluation,
	leader,
	whiteShare,
} from 'src/lib/engine';
import { evaluate, release } from './engine';

/**
 * The engine's evaluation of `fen`, or null before the first answer.
 *
 * The last answer stays up while the next is searched rather than blanking
 * the bar between moves, and says so through `isPending`.
 */
const useEvaluation = (fen: string) => {
	const [clientId] = useState(() => nanoid());
	const [answer, setAnswer] = useState<{
		fen: string;
		evaluation: Evaluation;
	} | null>(null);
	// Released when the bar goes rather than on every move: the last board to
	// release the engine starts its idle timer, and each move would start it.
	useEffect(() => () => release(clientId), [clientId]);

	// No check that the answer is for the position still on the board: the
	// queue drops a board's earlier requests the moment it asks again, so the
	// only answer that can arrive is for the newest.
	useEffect(() => {
		evaluate(clientId, fen, (answered, evaluation) =>
			setAnswer({ fen: answered, evaluation })
		);
	}, [clientId, fen]);

	return {
		evaluation: answer?.evaluation ?? null,
		isPending: answer?.fen !== fen,
	};
};

interface EvalBarProps {
	fen: string;
	orientation: 'white' | 'black';
}

/**
 * A bar beside the board: White's share fills from White's side, and the
 * number sits at the end of whoever is ahead. A score and nothing else - no
 * best move, no line - since it is there to say who stands better, not to
 * play the position for you.
 */
export const EvalBar = ({ fen, orientation }: EvalBarProps) => {
	const { evaluation, isPending } = useEvaluation(fen);
	const share = evaluation ? whiteShare(evaluation) : 0.5;
	// The bar's bottom is the side the board is turned for.
	const ahead = evaluation ? leader(evaluation) : 'w';
	const atBottom = (ahead === 'w') === (orientation === 'white');

	return (
		<div
			className={`cs-eval-bar is-${orientation}${isPending ? ' is-pending' : ''}`}
			title={`${
				evaluation ? `${formatEvaluation(evaluation)} - ` : ''
			}Stockfish 10, depth ${EVALUATION_DEPTH}`}
			aria-label={
				evaluation ? `Evaluation ${formatEvaluation(evaluation)}` : 'Evaluating'
			}
		>
			<div className="cs-eval-fill" style={{ height: `${share * 100}%` }} />
			{evaluation && (
				<span
					className={`cs-eval-label is-${ahead === 'w' ? 'white' : 'black'} ${
						atBottom ? 'is-bottom' : 'is-top'
					}`}
				>
					{formatBarLabel(evaluation)}
				</span>
			)}
		</div>
	);
};
