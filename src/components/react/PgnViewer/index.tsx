import * as React from 'react';
import { useMemo } from 'react';
import { MoveClassification } from 'src/lib/classification';
import { ChessStudyMove } from 'src/lib/storage';
import { StudyTitle } from './StudyTitle';
import { ControlActions, Controls } from './Controls';
import { MoveItem, VariantMoveItem } from './MoveItems';

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

export const VariantMoveItemContainer = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	return <div className="variant-move-item-container">{children}</div>;
};

export const VariantContainer = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	return <div className="variant-container">{children}</div>;
};

export const VariantsContainer = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	return <div className="variants-container">{children}</div>;
};

interface PgnViewerProps extends ControlActions {
	history: ChessStudyMove[];
	currentMoveId: string | null;
	firstPlayer: string;
	initialMoveNumber: number;
	title: string | null;
	isDirty: boolean;
	onTitleChange: (title: string | null) => void;
	onMoveItemClick: (moveId: string) => void;
	onClassify: (
		moveId: string,
		classification: MoveClassification | null
	) => void;
}

export const PgnViewer = React.memo((props: PgnViewerProps) => {
	const {
		history,
		currentMoveId,
		firstPlayer,
		initialMoveNumber,
		title,
		onTitleChange,
		onMoveItemClick,
		onClassify,
		...controlActions
	} = props;

	const movePairs = useMemo(
		() => chunkArray(history, 2, firstPlayer === 'b'),
		[firstPlayer, history]
	);

	return (
		<div className="cs-side">
			<div className="cs-side-header">
				<span className="cs-side-title">Moves</span>
				<StudyTitle title={title} onTitleChange={onTitleChange} />
			</div>
			<div className="move-item-section">
				{!history.length && (
					<p className="cs-empty-state">
						No moves yet. Play a move on the board to start the line.
					</p>
				)}
				<div className="move-item-container">
					{movePairs.map((pair, currentMoveIndex) => {
						const [wMove, bMove] = pair;

						return (
							<React.Fragment key={wMove.san + bMove?.san + currentMoveIndex}>
								<p className="move-indicator center">
									{currentMoveIndex + initialMoveNumber}
								</p>
								{firstPlayer === 'b' && !bMove && currentMoveIndex === 0 && (
									<MoveItem
										san={'...'}
										isCurrentMove={false}
										onMoveItemClick={() => {}}
									/>
								)}
								<MoveItem
									san={wMove.san}
									comment={wMove.comment}
									shapes={wMove.shapes}
									classification={wMove.classification}
									onClassify={(classification) =>
										onClassify(wMove.moveId, classification)
									}
									isCurrentMove={wMove.moveId === currentMoveId}
									onMoveItemClick={() => onMoveItemClick(wMove.moveId)}
								/>
								{bMove && (
									<MoveItem
										san={bMove.san}
										comment={bMove.comment}
										shapes={bMove.shapes}
										classification={bMove.classification}
										onClassify={(classification) =>
											onClassify(bMove.moveId, classification)
										}
										isCurrentMove={bMove.moveId === currentMoveId}
										onMoveItemClick={() => onMoveItemClick(bMove.moveId)}
									/>
								)}
								{!!wMove.variants.concat(bMove?.variants || []).length && (
									<VariantsContainer>
										{!!wMove.variants.length && (
											<VariantContainer>
												{wMove.variants.map((variant) => {
													return (
														<VariantMoveItemContainer key={variant.variantId}>
															{chunkArray(variant.moves, 2).map((pair, wMoveVarianti) => {
																const [bMove, wMove] = pair;

																return (
																	<React.Fragment
																		key={bMove.san + wMove?.san + currentMoveIndex}
																	>
																		<VariantMoveItem
																			isCurrentMove={bMove.moveId === currentMoveId}
																			san={bMove.san}
																			comment={bMove.comment}
																			shapes={bMove.shapes}
																			classification={bMove.classification}
																			onClassify={(classification) =>
																				onClassify(bMove.moveId, classification)
																			}
																			onMoveItemClick={() => onMoveItemClick(bMove.moveId)}
																			moveIndicator={
																				(wMoveVarianti === 0 &&
																					(firstPlayer === 'w' || currentMoveIndex > 0) &&
																					`${
																						currentMoveIndex + initialMoveNumber + wMoveVarianti
																					}... `) ||
																				(firstPlayer === 'b' &&
																					currentMoveIndex === 0 &&
																					`${
																						currentMoveIndex + initialMoveNumber + wMoveVarianti
																					}. `) ||
																				null
																			}
																		/>
																		{wMove && (
																			<VariantMoveItem
																				isCurrentMove={wMove.moveId === currentMoveId}
																				san={wMove.san}
																				comment={wMove.comment}
																				shapes={wMove.shapes}
																				classification={wMove.classification}
																				onClassify={(classification) =>
																					onClassify(wMove.moveId, classification)
																				}
																				onMoveItemClick={() => onMoveItemClick(wMove.moveId)}
																				moveIndicator={
																					((firstPlayer === 'w' || currentMoveIndex > 0) &&
																						`${
																							currentMoveIndex + initialMoveNumber + 1 + wMoveVarianti
																						}. `) ||
																					null
																				}
																			/>
																		)}
																	</React.Fragment>
																);
															})}
														</VariantMoveItemContainer>
													);
												})}
											</VariantContainer>
										)}
										{!!bMove?.variants.length && (
											<VariantContainer>
												{bMove.variants.map((variant) => {
													return (
														<VariantMoveItemContainer key={variant.variantId}>
															{chunkArray(variant.moves, 2).map((pair, bMoveVarianti) => {
																const [wMove, bMove] = pair;
																return (
																	<React.Fragment
																		key={wMove.san + bMove?.san + currentMoveIndex}
																	>
																		<VariantMoveItem
																			isCurrentMove={wMove.moveId === currentMoveId}
																			san={wMove.san}
																			comment={wMove.comment}
																			shapes={wMove.shapes}
																			classification={wMove.classification}
																			onClassify={(classification) =>
																				onClassify(wMove.moveId, classification)
																			}
																			onMoveItemClick={() => onMoveItemClick(wMove.moveId)}
																			moveIndicator={`${
																				currentMoveIndex + initialMoveNumber + 1 + bMoveVarianti
																			}. `}
																		/>
																		{bMove && (
																			<VariantMoveItem
																				isCurrentMove={bMove.moveId === currentMoveId}
																				san={bMove.san}
																				comment={bMove.comment}
																				shapes={bMove.shapes}
																				classification={bMove.classification}
																				onClassify={(classification) =>
																					onClassify(bMove.moveId, classification)
																				}
																				onMoveItemClick={() => onMoveItemClick(bMove.moveId)}
																			/>
																		)}
																	</React.Fragment>
																);
															})}
														</VariantMoveItemContainer>
													);
												})}
											</VariantContainer>
										)}
									</VariantsContainer>
								)}
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
