import * as React from 'react';
import { useMemo } from 'react';
import { MoveClassification } from 'src/lib/classification';
import { moveNumberAtPly } from 'src/lib/move-tree';
import { ChessStudyMove, Variant } from 'src/lib/storage';
import { ControlActions, Controls } from './Controls';
import { MoveItem, VariantMoveItem, VariationAction } from './MoveItems';
import { StudyTitle } from './StudyTitle';

const chunkArray = <T,>(array: T[], chunkSize: number, offsetByOne = false) => {
	return array.reduce((resultArray, item, index) => {
		const chunkIndex = Math.floor((index + (offsetByOne ? 1 : 0)) / chunkSize);

		if (!resultArray[chunkIndex]) {
			resultArray[chunkIndex] = [];
		}

		resultArray[chunkIndex].push(item);

		return resultArray;
	}, [] as T[][]);
};

/** Everything the recursive variation rendering needs but does not change. */
interface MoveListContext {
	currentMoveId: string | null;
	firstPlayer: string;
	initialMoveNumber: number;
	onMoveItemClick: (moveId: string) => void;
	onClassify: (
		moveId: string,
		classification: MoveClassification | null
	) => void;
	onVariationAction: (moveId: string, action: VariationAction) => void;
	onDeleteMove: (moveId: string) => void;
	/** Moves no drill can reach: the flagged ones and the lines under them. */
	excludedMoveIds: Set<string>;
	onSetExcluded: (moveId: string, excluded: boolean) => void;
}

interface VariationsProps extends MoveListContext {
	variants: Variant[];
	/** Half-move number the variation's first move sits at. */
	startPly: number;
	depth: number;
}

interface VariationMovesProps extends Omit<VariationsProps, 'variants'> {
	moves: ChessStudyMove[];
	/** Position of this variation among its siblings, for the context menu. */
	index: number;
	siblingCount: number;
}

/**
 * A run of moves inside one variation.
 *
 * Moves flow inline until one of them has variations of its own, at which point
 * the run is closed, the nested variations are rendered as their own indented
 * block, and a fresh run continues underneath - which is what gives the
 * chess.com-style sublist shape rather than one long parenthesised line.
 */
const VariationMoves = ({
	moves,
	startPly,
	depth,
	index,
	siblingCount,
	...context
}: VariationMovesProps) => {
	const blocks: React.ReactNode[] = [];
	let run: React.ReactNode[] = [];
	// The first move after any break restates the move number, so a line never
	// starts with a bare move you cannot place.
	let restateNumber = true;

	moves.forEach((move, index) => {
		const ply = startPly + index;
		const moveNumber = moveNumberAtPly(
			ply,
			context.firstPlayer,
			context.initialMoveNumber
		);

		const moveIndicator =
			move.color === 'w'
				? `${moveNumber}. `
				: restateNumber
				? `${moveNumber}... `
				: null;

		restateNumber = false;

		run.push(
			<VariantMoveItem
				key={move.moveId}
				isCurrentMove={move.moveId === context.currentMoveId}
				san={move.san}
				comment={move.comment}
				shapes={move.shapes}
				classification={move.classification}
				excluded={move.excluded}
				isUndrilled={context.excludedMoveIds.has(move.moveId)}
				onSetExcluded={(excluded) => context.onSetExcluded(move.moveId, excluded)}
				moveIndicator={moveIndicator}
				variation={{ depth, index, siblingCount }}
				onMoveItemClick={() => context.onMoveItemClick(move.moveId)}
				onClassify={(classification) =>
					context.onClassify(move.moveId, classification)
				}
				onDeleteMove={() => context.onDeleteMove(move.moveId)}
				onVariationAction={(action) =>
					context.onVariationAction(move.moveId, action)
				}
			/>
		);

		if (move.variants?.length) {
			blocks.push(
				<div className="variant-move-item-container" key={`run-${move.moveId}`}>
					{run}
				</div>
			);
			run = [];

			blocks.push(
				<Variations
					key={`variants-${move.moveId}`}
					variants={move.variants}
					startPly={ply + 1}
					depth={depth + 1}
					{...context}
				/>
			);

			restateNumber = true;
		}
	});

	if (run.length) {
		blocks.push(
			<div className="variant-move-item-container" key="run-tail">
				{run}
			</div>
		);
	}

	return <>{blocks}</>;
};

const Variations = ({ variants, depth, ...rest }: VariationsProps) => {
	if (!variants.length) return null;

	return (
		<div className="cs-variations" data-depth={Math.min(depth, 4)}>
			{variants.map((variant, index) => (
				<div className="cs-variation" key={variant.variantId}>
					<VariationMoves
						moves={variant.moves}
						depth={depth}
						index={index}
						siblingCount={variants.length}
						{...rest}
					/>
				</div>
			))}
		</div>
	);
};

interface PgnViewerProps extends ControlActions, MoveListContext {
	history: ChessStudyMove[];
	title: string | null;
	onTitleChange: (title: string | null) => void;
	/** The side the study is written for, or undefined until it has said. */
	playerColor: 'w' | 'b' | undefined;
	onPlayerColorChange: (color: 'w' | 'b') => void;
}

/**
 * Which side the study is written for: the one whose moves are the mainline.
 *
 * A study that has never said shows the side it is about to assume rather than
 * a blank, so the first click confirms it instead of changing it. That guess is
 * the board's orientation, which is also what the map falls back to.
 */
const PlayerColorChip = ({
	playerColor,
	onPlayerColorChange,
}: Pick<PgnViewerProps, 'playerColor' | 'onPlayerColorChange'>) => (
	<button
		className={`cs-color-chip${playerColor ? '' : ' is-assumed'}`}
		title={
			playerColor
				? 'The side this study is written for. Click to switch.'
				: 'This study has not said which side it is written for. Click to set it.'
		}
		onClick={() => onPlayerColorChange(playerColor === 'b' ? 'w' : 'b')}
	>
		<span
			className={`cs-color-dot is-${playerColor === 'b' ? 'black' : 'white'}`}
		/>
		{playerColor === 'b' ? 'Black' : 'White'}
	</button>
);

export const PgnViewer = React.memo((props: PgnViewerProps) => {
	const {
		history,
		currentMoveId,
		firstPlayer,
		initialMoveNumber,
		title,
		onTitleChange,
		playerColor,
		onPlayerColorChange,
		onMoveItemClick,
		onClassify,
		onVariationAction,
		onDeleteMove,
		excludedMoveIds,
		onSetExcluded,
		...controlActions
	} = props;

	const { isTraining } = controlActions;

	const context: MoveListContext = {
		currentMoveId,
		firstPlayer,
		initialMoveNumber,
		onMoveItemClick,
		onClassify,
		onVariationAction,
		onDeleteMove,
		excludedMoveIds,
		onSetExcluded,
	};

	// Pair the moves up by move number, carrying each one's index along so the
	// variations underneath know which ply they branch from.
	//
	// A training session empties the list: the move it is asking for is the
	// next one in here, so leaving it on screen would answer the question.
	const movePairs = useMemo(() => {
		if (isTraining) return [];

		return chunkArray(
			history.map((move, index) => ({ move, index })),
			2,
			firstPlayer === 'b'
		);
	}, [firstPlayer, history, isTraining]);

	return (
		<div className="cs-side">
			<div className="cs-side-header">
				<span className="cs-side-title">Moves</span>
				<StudyTitle title={title} onTitleChange={onTitleChange} />
				<PlayerColorChip
					playerColor={playerColor}
					onPlayerColorChange={onPlayerColorChange}
				/>
			</div>
			<div className="move-item-section">
				{isTraining && (
					<p className="cs-empty-state">
						Moves are hidden while training. Ask for a hint if you are stuck.
					</p>
				)}
				{!isTraining && !history.length && (
					<p className="cs-empty-state">
						No moves yet. Play a move on the board to start the line.
					</p>
				)}
				<div className="move-item-container">
					{movePairs.map((pair, pairIndex) => {
						const [white, black] = pair;
						const variations = [white, black].filter(
							(entry) => entry?.move.variants?.length
						);

						return (
							<React.Fragment key={white.move.moveId}>
								<p className="move-indicator center">{pairIndex + initialMoveNumber}</p>
								{firstPlayer === 'b' && !black && pairIndex === 0 && (
									<MoveItem
										san={'...'}
										isCurrentMove={false}
										onMoveItemClick={() => {}}
									/>
								)}
								{[white, black].map(
									(entry) =>
										entry && (
											<MoveItem
												key={entry.move.moveId}
												san={entry.move.san}
												comment={entry.move.comment}
												shapes={entry.move.shapes}
												classification={entry.move.classification}
												excluded={entry.move.excluded}
												isUndrilled={excludedMoveIds.has(entry.move.moveId)}
												onSetExcluded={(excluded) =>
													onSetExcluded(entry.move.moveId, excluded)
												}
												isCurrentMove={entry.move.moveId === currentMoveId}
												onMoveItemClick={() => onMoveItemClick(entry.move.moveId)}
												onClassify={(classification) =>
													onClassify(entry.move.moveId, classification)
												}
												onDeleteMove={() => onDeleteMove(entry.move.moveId)}
											/>
										)
								)}
								{variations.map((entry) => (
									<Variations
										key={`variants-${entry.move.moveId}`}
										variants={entry.move.variants}
										startPly={entry.index + 1}
										depth={1}
										{...context}
									/>
								))}
							</React.Fragment>
						);
					})}
				</div>
			</div>
			<Controls {...controlActions} />
		</div>
	);
});

PgnViewer.displayName = 'PgnViewer';
