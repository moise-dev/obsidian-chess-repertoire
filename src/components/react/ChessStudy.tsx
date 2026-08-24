import { JSONContent } from '@tiptap/react';
import { Chess, Move } from 'chess.js';
import { Api } from 'chessground/api';
import { DrawShape } from 'chessground/draw';
import { Draft } from 'immer';
import { nanoid } from 'nanoid';
import { App, MarkdownPostProcessorContext, Notice, TFile } from 'obsidian';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChessStudyPluginSettings } from 'src/components/obsidian/SettingsTab';
import {
	MoveClassification,
	classificationBadgeSvg,
	classificationForKey,
	readClassification,
} from 'src/lib/classification';
import { parseUserConfig } from 'src/lib/obsidian';
import {
	MAX_VARIATION_DEPTH,
	countMoves,
	getListAtPath,
	getMoveAtPath,
	getParentMovePath,
	getVariationRef,
	moveVariationAtPath,
	pathDepth,
	promoteToMainline,
	promoteVariationAtPath,
	removeMoveAtPath,
	removeVariationAtPath,
} from 'src/lib/move-tree';
import {
	ChessStudyDataAdapter,
	ChessStudyFileData,
	ChessStudyMove,
	VariantMove,
} from 'src/lib/storage';
import {
	displayMoveInHistory,
	displayPosition,
	findMovePathById,
	getCurrentMove,
	getMoveLabel,
} from 'src/lib/ui-state';
import { useImmerReducer } from 'use-immer';
import { ChessgroundProps, ChessgroundWrapper } from './ChessgroundWrapper';
import { CommentSection } from './CommentSection';
import { ConfirmModal } from '../obsidian/ConfirmModal';
import { PgnViewer } from './PgnViewer';
import { VariationAction } from './PgnViewer/MoveItems';
import { TrainerBar, TrainerReportPanel, useTrainer } from './Trainer';

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

/** Its own type rather than a member of the union below, which prettier sets
 *  with an indentation eslint then refuses. */
interface ClassifyAction {
	type: 'SET_CLASSIFICATION';
	classification: MoveClassification | null;
	/** Defaults to the current move; the context menu passes an explicit one. */
	moveId?: string;
}

export type GameActions =
	| { type: 'ADD_MOVE_TO_HISTORY'; move: Move }
	| { type: 'REMOVE_LAST_MOVE_FROM_HISTORY' }
	| { type: 'DISPLAY_NEXT_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY'; moveId: string }
	| { type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' }
	| { type: 'DISPLAY_LAST_MOVE_IN_HISTORY' }
	/** Put the board back to the move it is already on, undoing what was
	 *  played on it - the trainer's way of refusing a move. */
	| { type: 'RESET_BOARD_TO_CURRENT' }
	| { type: 'SYNC_SHAPES'; shapes: DrawShape[] }
	| { type: 'SYNC_COMMENT'; comment: JSONContent | null }
	| ClassifyAction
	| { type: 'SET_TITLE'; title: string | null }
	| { type: 'PROMOTE_VARIATION'; moveId: string; toMainline: boolean }
	| { type: 'DELETE_VARIATION'; moveId: string }
	| { type: 'REORDER_VARIATION'; moveId: string; delta: number };

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

					if (!currentMoveId) return draft;

					const path = findMovePathById(moves, currentMoveId);
					const list = path && getListAtPath(moves, path);

					if (!path || !list) return draft;

					const moveIndex = path[path.length - 1];

					// Only the last move of a line can be taken back; deleting from the
					// middle would orphan everything after it.
					if (moveIndex !== list.length - 1) return draft;

					// Step back before the move disappears, so the board follows.
					displayMoveInHistory(draft, chessView, setChessLogic, {
						offset: -1,
						selectedMoveId: currentMoveId,
					});

					removeMoveAtPath(moves, path);

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
				case 'RESET_BOARD_TO_CURRENT': {
					if (!chessView) return draft;

					displayPosition(draft, chessView, setChessLogic, getCurrentMove(draft));

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
				case 'SET_CLASSIFICATION': {
					if (hasNoMoves) return draft;

					const moveId = action.moveId;

					if (!moveId) {
						const move = getCurrentMove(draft);

						if (move) {
							move.classification = action.classification;
							draft.currentMove = move;
						}

						return draft;
					}

					const moves = draft.study.moves;
					const path = findMovePathById(moves, moveId);
					const move = path && getMoveAtPath(moves, path);

					if (!move) return draft;

					move.classification = action.classification;

					if (draft.currentMove?.moveId === moveId) draft.currentMove = move;

					return draft;
				}
				case 'PROMOTE_VARIATION': {
					const moves = draft.study.moves;

					if (action.toMainline) {
						promoteToMainline(moves, action.moveId, nanoid);
					} else {
						const path = findMovePathById(moves, action.moveId);

						if (path) promoteVariationAtPath(moves, path, nanoid);
					}

					// Promotion only moves lines around, so the position on the board
					// is still the one the current move produced.
					return draft;
				}
				case 'DELETE_VARIATION': {
					if (!chessView) return draft;

					const moves = draft.study.moves;
					const path = findMovePathById(moves, action.moveId);

					if (!path) return draft;

					// Where to land if the move we are looking at is inside the
					// variation about to disappear.
					const parentPath = getParentMovePath(path);
					const fallback = parentPath ? getMoveAtPath(moves, parentPath) : null;

					if (!removeVariationAtPath(moves, path)) return draft;

					const currentId = draft.currentMove?.moveId;

					if (currentId && !findMovePathById(moves, currentId)) {
						displayPosition(draft, chessView, setChessLogic, fallback ?? null);
					}

					return draft;
				}
				case 'REORDER_VARIATION': {
					const moves = draft.study.moves;
					const path = findMovePathById(moves, action.moveId);

					if (path) moveVariationAtPath(moves, path, action.delta);

					return draft;
				}
				case 'SET_TITLE': {
					draft.study.header = {
						...draft.study.header,
						title: action.title,
					};

					return draft;
				}
				case 'ADD_MOVE_TO_HISTORY': {
					const newMove = action.move;
					const moves = draft.study.moves;
					const currentMoveId = draft.currentMove?.moveId;

					const makeMove = (): Draft<ChessStudyMove> =>
						({
							...newMove,
							moveId: nanoid(),
							variants: [],
							shapes: [],
							comment: null,
							classification: null,
						} as Draft<ChessStudyMove>);

					// Nothing selected: we are at the root position.
					if (!currentMoveId) {
						// Replaying the mainline from the start should follow it, not
						// append a duplicate at the end.
						if (moves[0]?.san === newMove.san) {
							draft.currentMove = moves[0];
							return draft;
						}

						if (!moves.length) {
							const move = makeMove();
							moves.push(move);
							draft.currentMove = move;
						}

						return draft;
					}

					const path = findMovePathById(moves, currentMoveId);
					const list = path && getListAtPath(moves, path);
					const currentMove = path && getMoveAtPath(moves, path);

					if (!path || !list || !currentMove) return draft;

					const moveIndex = path[path.length - 1];
					const nextMove = list[moveIndex + 1];

					// End of the line: just continue it, at whatever depth we are.
					if (!nextMove) {
						const move = makeMove();
						list.push(move);
						draft.currentMove = move;
						return draft;
					}

					// The move already continues this line.
					if (nextMove.san === newMove.san) {
						draft.currentMove = nextMove;
						return draft;
					}

					// An existing variation already starts with this move - follow it
					// rather than creating a second one saying the same thing.
					const existing = currentMove.variants.find(
						(variant) => variant.moves[0]?.san === newMove.san
					);

					if (existing) {
						draft.currentMove = existing.moves[0];
						return draft;
					}

					if (pathDepth(path) + 1 > MAX_VARIATION_DEPTH) {
						new Notice(
							`Variations can only nest ${MAX_VARIATION_DEPTH} deep.`
						);
						return draft;
					}

					const move = makeMove();

					currentMove.variants.push({
						parentMoveId: currentMove.moveId,
						variantId: nanoid(),
						moves: [move],
					});

					draft.currentMove = move;

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

	// Serialised form of what is currently on disk, so a save that would be a
	// no-op is skipped. Navigation does not touch `study`, but this keeps the
	// autosave correct even if some future action touches it without changing it.
	const savedSnapshot = useRef(JSON.stringify(chessStudyData));
	const [isDirty, setIsDirty] = useState(false);

	const saveStudy = useCallback(async () => {
		const snapshot = JSON.stringify(gameState.study);

		if (snapshot === savedSnapshot.current) {
			setIsDirty(false);
			return;
		}

		await dataAdapter.saveFile(gameState.study, chessStudyId);

		savedSnapshot.current = snapshot;
		setIsDirty(false);
	}, [chessStudyId, dataAdapter, gameState.study]);

	const onSaveButtonClick = useCallback(async () => {
		try {
			await saveStudy();
			new Notice('Save successfull!');
		} catch (e) {
			new Notice('Something went wrong during saving:', e);
		}
	}, [saveStudy]);

	// Autosave. `saveStudy` is held in a ref so the debounce timer always calls
	// the latest version without restarting every time the study changes.
	const saveStudyRef = useRef(saveStudy);
	saveStudyRef.current = saveStudy;

	// A failed autosave stays silent: the dirty dot is the signal, and a notice
	// on every retry would be worse than the problem.
	const autosave = () =>
		saveStudyRef
			.current()
			.catch((e) => console.error('chess-study: autosave failed', e));

	useEffect(() => {
		if (JSON.stringify(gameState.study) === savedSnapshot.current) return;

		setIsDirty(true);

		const timer = window.setTimeout(autosave, 1200);

		// Only cancels the pending save - this cleanup runs on every change, so
		// flushing here would fire on each one and defeat the debounce.
		return () => window.clearTimeout(timer);
	}, [gameState.study]);

	// Flush on unmount, so closing the note commits whatever is still pending.
	// Empty deps, so this cleanup runs once and only when the widget goes away.
	useEffect(() => () => void autosave(), []);

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

	const onVariationAction = useCallback(
		(moveId: string, action: VariationAction) => {
			switch (action) {
				case 'promote':
					dispatch({ type: 'PROMOTE_VARIATION', moveId, toMainline: false });
					return;
				case 'promote-to-mainline':
					dispatch({ type: 'PROMOTE_VARIATION', moveId, toMainline: true });
					return;
				case 'move-up':
					dispatch({ type: 'REORDER_VARIATION', moveId, delta: -1 });
					return;
				case 'move-down':
					dispatch({ type: 'REORDER_VARIATION', moveId, delta: 1 });
					return;
				case 'delete': {
					// There is no undo and autosave commits moments later, so say how
					// much is about to go and make the user agree to it.
					const path = findMovePathById(gameState.study.moves, moveId);
					const ref = path && getVariationRef(gameState.study.moves, path);
					const moveCount = ref
						? countMoves(ref.parentMove.variants[ref.variantIndex].moves)
						: 0;

					if (!moveCount) return;

					new ConfirmModal(app, {
						title: 'Delete variation?',
						body: `This removes ${moveCount} ${
							moveCount === 1 ? 'move' : 'moves'
						}, including any variations nested inside it. This cannot be undone.`,
						confirmText: 'Delete',
						onConfirm: () => dispatch({ type: 'DELETE_VARIATION', moveId }),
					}).open();
					return;
				}
			}
		},
		[app, dispatch, gameState.study.moves]
	);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			// Never hijack keys while anything is being typed into. ProseMirror is
			// a contenteditable div, so this one check covers the notes editor and
			// the title field both.
			if (
				(event.target as HTMLElement).closest(
					'input, textarea, [contenteditable="true"]'
				)
			)
				return;

			const shortcut = classificationForKey(event.key);

			if (shortcut) {
				dispatch({
					type: 'SET_CLASSIFICATION',
					classification: shortcut.classification,
				});
				event.preventDefault();
				event.stopPropagation();
				return;
			}

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

	const trainer = useTrainer({
		app,
		moves: gameState.study.moves,
		currentMoveId,
		chess: chessLogic,
		firstPlayer,
		initialMoveNumber,
		dispatch,
		setOrientation,
	});

	// chess.com-style badge on the destination square of the current move. This
	// goes to setAutoShapes, never setShapes, so it can never end up in the
	// user's saved arrows.
	const classificationShapes: DrawShape[] = useMemo(() => {
		const move = gameState.currentMove;
		const classification = readClassification(move?.classification);

		if (!move || !classification) return [];

		return [
			{
				orig: move.to,
				brush: 'green',
				customSvg: classificationBadgeSvg(classification),
			},
		];
	}, [gameState.currentMove]);

	// Hint marks sit alongside the classification badge rather than replacing
	// it: the badge belongs to the move already played, never to the one the
	// drill is asking for, so it gives nothing away.
	const autoShapes = useMemo(
		() => [...classificationShapes, ...trainer.shapes],
		[classificationShapes, trainer.shapes]
	);

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
							trainer.isActive
								? trainer.submitMove(move)
								: dispatch({ type: 'ADD_MOVE_TO_HISTORY', move })
						}
						isViewOnly={gameState.isViewOnly || trainer.isBoardLocked}
						syncShapes={(shapes: DrawShape[]) =>
							dispatch({ type: 'SYNC_SHAPES', shapes })
						}
						shapes={gameState.currentMove?.shapes || []}
						autoShapes={autoShapes}
					/>
				</div>

				<PgnViewer
					history={gameState.study.moves}
					currentMoveId={currentMoveId}
					firstPlayer={firstPlayer}
					initialMoveNumber={initialMoveNumber}
					title={gameState.study.header?.title ?? null}
					isDirty={isDirty}
					isTraining={trainer.isActive}
					onTrainButtonClick={() =>
						trainer.isActive ? trainer.stop() : trainer.start()
					}
					onTitleChange={(title: string | null) =>
						dispatch({ type: 'SET_TITLE', title })
					}
					onClassify={(
						moveId: string,
						classification: MoveClassification | null
					) => dispatch({ type: 'SET_CLASSIFICATION', classification, moveId })}
					onVariationAction={onVariationAction}
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

			{trainer.isActive ? (
				<TrainerBar {...trainer} />
			) : trainer.report ? (
				<TrainerReportPanel
					report={trainer.report}
					onDismiss={trainer.dismissReport}
				/>
			) : (
				<CommentSection
					currentComment={gameState.currentMove?.comment ?? null}
					setComments={(comment: JSONContent) =>
						dispatch({ type: 'SYNC_COMMENT', comment: comment })
					}
					moveLabel={moveLabel}
					defaultOpen={viewComments}
					classification={gameState.currentMove?.classification ?? null}
					onClassify={(classification: MoveClassification | null) =>
						dispatch({ type: 'SET_CLASSIFICATION', classification })
					}
				/>
			)}

			<div
				className="cs-resize-handle"
				title="Drag to resize"
				onPointerDown={onResizePointerDown}
			/>
		</div>
	);
};
