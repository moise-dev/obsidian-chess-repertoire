import { JSONContent } from '@tiptap/react';
import { Chess, Move } from 'chess.js';
import { Api } from 'chessground/api';
import { DrawShape } from 'chessground/draw';
import { nanoid } from 'nanoid';
import { App, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import * as React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ChessStudyPluginSettings } from 'src/components/obsidian/SettingsTab';
import { parseUserConfig } from 'src/lib/obsidian';
import {
	ChessStudyDataAdapter,
	ChessStudyFileData,
	ChessStudyMove,
	VariantMove,
} from 'src/lib/storage';
import {
	displayMoveInHistory,
	displayPosition,
	findMoveIndex,
	getCurrentMove,
	getMoveLabel,
} from 'src/lib/ui-state';
import { useImmerReducer } from 'use-immer';
import { ChessgroundProps, ChessgroundWrapper } from './ChessgroundWrapper';
import { CommentSection } from './CommentSection';
import { PgnViewer } from './PgnViewer';

export type ChessStudyConfig = ChessgroundProps;

interface AppProps {
	source: string;
	app: App;
	ctx: MarkdownPostProcessorContext;
	containerEl: HTMLElement;
	pluginSettings: ChessStudyPluginSettings;
	chessStudyData: ChessStudyFileData;
	dataAdapter: ChessStudyDataAdapter;
}

/** Narrowest the widget may be dragged, in px. */
const MIN_WIDTH = 320;

export interface GameState {
	currentMove: ChessStudyMove | VariantMove | null;
	isViewOnly: boolean;
	study: ChessStudyFileData;
}

export type GameActions =
	| { type: 'ADD_MOVE_TO_HISTORY'; move: Move }
	| { type: 'REMOVE_LAST_MOVE_FROM_HISTORY' }
	| { type: 'DISPLAY_NEXT_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY'; moveId: string }
	| { type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_LAST_MOVE_IN_HISTORY' }
	| { type: 'SYNC_SHAPES'; shapes: DrawShape[] }
	| { type: 'SYNC_COMMENT'; comment: JSONContent | null };

export const ChessStudy = ({
	source,
	app,
	ctx,
	containerEl,
	pluginSettings,
	chessStudyData,
	dataAdapter,
}: AppProps) => {
	// Parse Obsidian / Code Block Settings
	const {
		boardColor,
		boardOrientation,
		viewComments,
		boardSize,
		showCoordinates,
		chessStudyId,
	} = parseUserConfig(pluginSettings, source);

	// Setup Chessground API
	const [chessView, setChessView] = useState<Api | null>(null);

	// Orientation lives in state rather than being read straight from the
	// config on every render: ChessgroundWrapper re-applies its `config` prop
	// to the board, so a plain api.toggleOrientation() would be undone by the
	// next render.
	const [orientation, setOrientation] = useState(boardOrientation);

	const chessgroundConfig = useMemo(
		() => ({ orientation, coordinates: showCoordinates }),
		[orientation, showCoordinates]
	);

	const rootRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState<number | null>(boardSize ?? null);

	// Setup Chess.js API
	const [initialChessLogic, firstPlayer, initialMoveNumber] = useMemo(() => {
		const chess = new Chess(chessStudyData.rootFEN);

		const firstPlayer = chess.turn();
		const initialMoveNumber = chess.moveNumber();

		chessStudyData.moves.forEach((move) => {
			chess.move({
				from: move.from,
				to: move.to,
				promotion: move.promotion,
			});
		});

		return [chess, firstPlayer, initialMoveNumber];
	}, [chessStudyData.moves, chessStudyData.rootFEN]);

	const [chessLogic, setChessLogic] = useState(initialChessLogic);

	const [gameState, dispatch] = useImmerReducer<GameState, GameActions>(
		(draft, action) => {
			const hasNoMoves = draft.study.moves.length === 0;
			switch (action.type) {
				case 'DISPLAY_NEXT_MOVE_IN_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					displayMoveInHistory(draft, chessView, setChessLogic, {
						offset: 1,
						selectedMoveId: null,
					});

					return draft;
				}
				case 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					displayMoveInHistory(draft, chessView, setChessLogic, {
						offset: -1,
						selectedMoveId: null,
					});

					return draft;
				}
				case 'REMOVE_LAST_MOVE_FROM_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					const moves = draft.study.moves;

					const currentMoveId = draft.currentMove?.moveId;

					if (currentMoveId) {
						const { variant, moveIndex } = findMoveIndex(moves, currentMoveId);

						if (variant) {
							const parent = moves[variant.parentMoveIndex];
							const variantMoves = parent.variants[variant.variantIndex].moves;

							const isLastMove = moveIndex === variantMoves.length - 1;

							if (isLastMove) {
								displayMoveInHistory(draft, chessView, setChessLogic, {
									offset: -1,
									selectedMoveId: currentMoveId,
								});
							}

							variantMoves.pop();
							if (variantMoves.length === 0) {
								parent.variants.splice(variant.variantIndex, 1);
							}

							if (isLastMove) {
								draft.currentMove =
									variantMoves.length > 0
										? variantMoves[variantMoves.length - 1]
										: moves[variant.parentMoveIndex];
							}
						} else {
							const isLastMove = moveIndex === moves.length - 1;

							if (isLastMove) {
								displayMoveInHistory(draft, chessView, setChessLogic, {
									offset: -1,
									selectedMoveId: currentMoveId,
								});
							}

							moves.pop();

							if (isLastMove) {
								draft.currentMove = moves.length > 0 ? moves[moves.length - 1] : null;
							}
						}
					}

					return draft;
				}
				case 'DISPLAY_SELECTED_MOVE_IN_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					const selectedMoveId = action.moveId;

					displayMoveInHistory(draft, chessView, setChessLogic, {
						offset: 0,
						selectedMoveId: selectedMoveId,
					});

					return draft;
				}
				case 'DISPLAY_FIRST_MOVE_IN_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					displayPosition(draft, chessView, setChessLogic, null);

					return draft;
				}
				case 'DISPLAY_LAST_MOVE_IN_HISTORY': {
					if (!chessView || hasNoMoves) return draft;

					const moves = draft.study.moves;

					displayPosition(
						draft,
						chessView,
						setChessLogic,
						moves[moves.length - 1]
					);

					return draft;
				}
				case 'SYNC_SHAPES': {
					if (!chessView || hasNoMoves) return draft;

					const move = getCurrentMove(draft);

					if (move) {
						move.shapes = action.shapes;
						draft.currentMove = move;
					}

					return draft;
				}
				case 'SYNC_COMMENT': {
					if (!chessView || hasNoMoves) return draft;

					const move = getCurrentMove(draft);

					if (move) {
						move.comment = action.comment;
						draft.currentMove = move;
					}

					return draft;
				}
				case 'ADD_MOVE_TO_HISTORY': {
					const newMove = action.move;

					const moves = draft.study.moves;
					const currentMoveId = draft.currentMove?.moveId;

					const moveId = nanoid();

					if (currentMoveId) {
						const currentMoveIndex = moves.findIndex(
							(move) => move.moveId === currentMoveId
						);

						const { variant, moveIndex } = findMoveIndex(moves, currentMoveId);

						if (variant) {
							//handle variant
							const parent = moves[variant.parentMoveIndex];
							const variantMoves = parent.variants[variant.variantIndex].moves;

							const isLastMove = moveIndex === variantMoves.length - 1;

							//Only push if its the last move in the variant because depth can only be 1
							if (isLastMove) {
								const move = {
									...newMove,
									moveId: moveId,
									shapes: [],
									comment: null,
								};
								variantMoves.push(move);

								const tempChess = new Chess(newMove.after);

								draft.currentMove = move;

								chessView?.set({
									fen: newMove.after,
									check: tempChess.isCheck(),
								});
							}
						} else {
							//handle main line
							const isLastMove = currentMoveIndex === moves.length - 1;

							if (isLastMove) {
								const move = {
									...newMove,
									moveId: moveId,
									variants: [],
									shapes: [],
									comment: null,
								};
								moves.push(move);

								draft.currentMove = move;
							} else {
								const currentMove = moves[moveIndex];

								// check if the next move is the same move
								const nextMove = moves[moveIndex + 1];

								if (nextMove.san === newMove.san) {
									draft.currentMove = nextMove;
									return draft;
								}

								const move = {
									...newMove,
									moveId: moveId,
									shapes: [],
									comment: null,
								};

								currentMove.variants.push({
									parentMoveId: currentMove.moveId,
									variantId: nanoid(),
									moves: [move],
								});

								draft.currentMove = move;
							}
						}
					} else {
						const move = {
							...newMove,
							moveId: moveId,
							variants: [],
							shapes: [],
							comment: null,
						};
						moves.push(move);

						draft.currentMove = move;
					}

					return draft;
				}
				default:
					break;
			}
		},
		{
			currentMove: chessStudyData.moves[chessStudyData.moves.length - 1] ?? null,
			isViewOnly: false,
			study: chessStudyData,
		}
	);

	const saveStudy = useCallback(
		() => dataAdapter.saveFile(gameState.study, chessStudyId),
		[chessStudyId, dataAdapter, gameState.study]
	);

	const onSaveButtonClick = useCallback(async () => {
		try {
			await saveStudy();
			new Notice('Save successfull!');
		} catch (e) {
			new Notice('Something went wrong during saving:', e);
		}
	}, [saveStudy]);

	/**
	 * Write the dragged width back into the code block so the study keeps its
	 * size. Obsidian re-renders the block once its source changes, which drops
	 * anything not yet on disk, so the study is flushed first.
	 */
	const persistWidth = useCallback(
		async (size: number) => {
			const info = ctx.getSectionInfo(containerEl);
			const file = app.vault.getAbstractFileByPath(ctx.sourcePath);

			if (!info || !(file instanceof TFile)) return;

			try {
				await saveStudy();

				await app.vault.process(file, (data) => {
					const lines = data.split('\n');

					// The section may have moved since it was rendered; only touch
					// it if it still looks like our code block.
					if (!lines[info.lineStart]?.trimStart().startsWith('```')) {
						return data;
					}

					const body = lines.slice(info.lineStart + 1, info.lineEnd);
					const existing = body.findIndex((line) =>
						/^\s*boardSize\s*:/.test(line)
					);

					if (existing >= 0) body[existing] = `boardSize: ${size}`;
					else body.push(`boardSize: ${size}`);

					lines.splice(
						info.lineStart + 1,
						info.lineEnd - info.lineStart - 1,
						...body
					);

					return lines.join('\n');
				});
			} catch (e) {
				console.error('chess-study: could not persist the board size', e);
			}
		},
		[app, containerEl, ctx, saveStudy]
	);

	const onResizePointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const root = rootRef.current;
			if (!root) return;

			event.preventDefault();

			const startX = event.clientX;
			const startWidth = root.getBoundingClientRect().width;
			const maxWidth =
				root.parentElement?.getBoundingClientRect().width ?? startWidth;

			let nextWidth = startWidth;

			// The width is written straight to the DOM while dragging: going
			// through React state would re-render (and reflow the board) on
			// every pointer event.
			const onPointerMove = (moveEvent: PointerEvent) => {
				nextWidth = Math.round(
					Math.min(
						Math.max(startWidth + (moveEvent.clientX - startX), MIN_WIDTH),
						maxWidth
					)
				);
				root.style.setProperty('--cs-width', `${nextWidth}px`);
			};

			const onPointerUp = () => {
				window.removeEventListener('pointermove', onPointerMove);
				window.removeEventListener('pointerup', onPointerUp);

				setWidth(nextWidth);
				persistWidth(nextWidth);
			};

			window.addEventListener('pointermove', onPointerMove);
			window.addEventListener('pointerup', onPointerUp);
		},
		[persistWidth]
	);

	/**
	 * Chessground calls preventDefault on mousedown to drive dragging, which
	 * stops the widget from picking up focus on its own - and without focus the
	 * arrow keys never reach onKeyDown. Claim focus in the capture phase
	 * instead, but leave the notes editor and the buttons alone.
	 */
	const onPointerDownCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement;

			if (target.closest('.ProseMirror') || target.closest('button')) return;

			rootRef.current?.focus({ preventScroll: true });
		},
		[]
	);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			// Never hijack the arrow keys while a note is being written.
			if ((event.target as HTMLElement).closest('.ProseMirror')) return;

			switch (event.key) {
				case 'ArrowLeft':
					dispatch({ type: 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY' });
					break;
				case 'ArrowRight':
					dispatch({ type: 'DISPLAY_NEXT_MOVE_IN_HISTORY' });
					break;
				case 'ArrowUp':
					dispatch({ type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' });
					break;
				case 'ArrowDown':
					dispatch({ type: 'DISPLAY_LAST_MOVE_IN_HISTORY' });
					break;
				default:
					return;
			}

			event.preventDefault();
			event.stopPropagation();
		},
		[dispatch]
	);

	const currentMoveId = gameState.currentMove?.moveId ?? null;

	const moveLabel = useMemo(
		() =>
			getMoveLabel(
				gameState.study.moves,
				currentMoveId,
				firstPlayer,
				initialMoveNumber
			),
		[currentMoveId, firstPlayer, gameState.study.moves, initialMoveNumber]
	);

	return (
		<div
			className="chess-study"
			ref={rootRef}
			style={
				width
					? ({ '--cs-width': `${width}px` } as React.CSSProperties)
					: undefined
			}
			tabIndex={0}
			onKeyDown={onKeyDown}
			onPointerDownCapture={onPointerDownCapture}
		>
			<div className="cs-main">
				<div className="cs-board-wrap">
					<ChessgroundWrapper
						api={chessView}
						setApi={setChessView}
						config={chessgroundConfig}
						boardColor={boardColor}
						chess={chessLogic}
						addMoveToHistory={(move: Move) =>
							dispatch({ type: 'ADD_MOVE_TO_HISTORY', move })
						}
						isViewOnly={gameState.isViewOnly}
						syncShapes={(shapes: DrawShape[]) =>
							dispatch({ type: 'SYNC_SHAPES', shapes })
						}
						shapes={gameState.currentMove?.shapes || []}
					/>
				</div>

				<PgnViewer
					history={gameState.study.moves}
					currentMoveId={currentMoveId}
					firstPlayer={firstPlayer}
					initialMoveNumber={initialMoveNumber}
					title={gameState.study.header.title}
					onUndoButtonClick={() =>
						dispatch({ type: 'REMOVE_LAST_MOVE_FROM_HISTORY' })
					}
					onFirstButtonClick={() =>
						dispatch({ type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' })
					}
					onBackButtonClick={() =>
						dispatch({ type: 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY' })
					}
					onForwardButtonClick={() =>
						dispatch({ type: 'DISPLAY_NEXT_MOVE_IN_HISTORY' })
					}
					onLastButtonClick={() =>
						dispatch({ type: 'DISPLAY_LAST_MOVE_IN_HISTORY' })
					}
					onFlipButtonClick={() =>
						setOrientation((current) =>
							current === 'white' ? 'black' : 'white'
						)
					}
					onMoveItemClick={(moveId: string) =>
						dispatch({
							type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
							moveId: moveId,
						})
					}
					onSaveButtonClick={onSaveButtonClick}
					onCopyButtonClick={() => {
						try {
							navigator.clipboard.writeText(chessLogic.fen());
							new Notice('Copied to clipboard!');
						} catch (e) {
							new Notice('Could not copy to clipboard:', e);
						}
					}}
				/>
			</div>

			<CommentSection
				currentComment={gameState.currentMove?.comment ?? null}
				setComments={(comment: JSONContent) =>
					dispatch({ type: 'SYNC_COMMENT', comment: comment })
				}
				moveLabel={moveLabel}
				defaultOpen={viewComments}
			/>

			<div
				className="cs-resize-handle"
				title="Drag to resize"
				onPointerDown={onResizePointerDown}
			/>
		</div>
	);
};
