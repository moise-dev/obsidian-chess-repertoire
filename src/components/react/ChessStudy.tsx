import { JSONContent } from '@tiptap/react';
import { Chess, Move } from 'chess.js';
import { Api } from 'chessground/api';
import { DrawShape } from 'chessground/draw';
import { Draft } from 'immer';
import { nanoid } from 'nanoid';
import {
	App,
	MarkdownPostProcessorContext,
	Notice,
	TFile,
	normalizePath,
} from 'obsidian';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChessStudyPluginSettings } from 'src/components/obsidian/SettingsTab';
import { JsonCanvas } from 'src/lib/canvas';
import {
	MoveClassification,
	classificationBadgeSvg,
	classificationForKey,
	readClassification,
} from 'src/lib/classification';
import { collectExcludedMoveIds, resolveStudyColor } from 'src/lib/drill';
import { registerStudyKeys, setActiveStudy } from 'src/lib/keyboard';
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
	removeMovesFromPath,
	removeVariationAtPath,
} from 'src/lib/move-tree';
import { parseUserConfig } from 'src/lib/obsidian';
import { exportPgn } from 'src/lib/pgn';
import {
	ChessStudyDataAdapter,
	ChessStudyFileData,
	ChessStudyMove,
} from 'src/lib/storage';
import {
	displayMoveInHistory,
	displayPosition,
	findMovePathById,
	getCurrentMove,
	getMoveLabel,
} from 'src/lib/ui-state';
import { ROOT_FEN } from 'src/main';
import { useImmerReducer } from 'use-immer';
import { ConfirmModal } from '../obsidian/ConfirmModal';
import { ExportModal } from '../obsidian/ExportModal';
import { MoveMapModal } from '../obsidian/MoveMapModal';
import { ChessgroundProps, ChessgroundWrapper } from './ChessgroundWrapper';
import { CommentSection } from './CommentSection';
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

/** Stable empty array, so an unannotated move does not redraw the board. */
const NO_SHAPES: DrawShape[] = [];

export interface GameState {
	currentMove: ChessStudyMove | null;
	study: ChessStudyFileData;
}

/** Named rather than inlined below, where prettier's indentation of a wide
 *  union member trips no-mixed-spaces-and-tabs. */
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
	/** Put the board back to the move it is already on: how the trainer
	 *  refuses a move without recording it. */
	| { type: 'RESET_BOARD_TO_CURRENT' }
	| { type: 'SYNC_SHAPES'; shapes: DrawShape[] }
	| { type: 'SYNC_COMMENT'; comment: JSONContent | null }
	| ClassifyAction
	| { type: 'SET_TITLE'; title: string | null }
	/** Which side the study is written for, i.e. whose moves the mainline is. */
	| { type: 'SET_PLAYER_COLOR'; color: 'w' | 'b' }
	| { type: 'PROMOTE_VARIATION'; moveId: string; toMainline: boolean }
	| { type: 'DELETE_VARIATION'; moveId: string }
	/** The move and the rest of its line, that line only. */
	| { type: 'DELETE_FROM_MOVE'; moveId: string }
	/** Keep the move but take it, and the line under it, out of drills. */
	| { type: 'SET_EXCLUDED'; moveId: string; excluded: boolean }
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
		coordinateColor,
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

	// Both of these are read by the stylesheet rather than applied directly:
	// the width by the shell, the colour by the coordinate labels, which are
	// chessground's elements and so out of React's reach.
	const rootStyle = useMemo(() => {
		const style: Record<string, string> = {};

		if (width) style['--cs-width'] = `${width}px`;
		if (coordinateColor) style['--cs-coord-color'] = coordinateColor;

		return Object.keys(style).length ? (style as React.CSSProperties) : undefined;
	}, [width, coordinateColor]);

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

					displayMoveInHistory(draft, chessView, setChessLogic, {
						offset: 0,
						selectedMoveId: action.moveId,
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

					displayPosition(draft, chessView, setChessLogic, moves[moves.length - 1]);

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

					// The keyboard shortcut labels the current move; the context menu
					// names the one it was opened on.
					const moveId = action.moveId ?? draft.currentMove?.moveId;
					const moves = draft.study.moves;
					const path = moveId ? findMovePathById(moves, moveId) : null;
					const move = path && getMoveAtPath(moves, path);

					if (!move) return draft;

					move.classification = action.classification;

					if (draft.currentMove?.moveId === moveId) draft.currentMove = move;

					return draft;
				}
				case 'SET_PLAYER_COLOR': {
					draft.study.playerColor = action.color;

					return draft;
				}
				case 'SET_EXCLUDED': {
					const moves = draft.study.moves;
					const path = findMovePathById(moves, action.moveId);
					const move = path && getMoveAtPath(moves, path);

					if (!move) return draft;

					// Removed rather than set to false, so a study that has never
					// excluded anything carries no trace of the flag.
					if (action.excluded) move.excluded = true;
					else delete move.excluded;

					if (draft.currentMove?.moveId === action.moveId) draft.currentMove = move;

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
				case 'DELETE_FROM_MOVE': {
					if (!chessView) return draft;

					const moves = draft.study.moves;
					const path = findMovePathById(moves, action.moveId);
					const list = path && getListAtPath(moves, path);

					if (!path || !list) return draft;

					// Where to land if we are looking at something about to go: the
					// move before this one, or the move its variation hangs off.
					const index = path[path.length - 1];
					const parentPath = getParentMovePath(path);
					const fallback =
						index > 0
							? list[index - 1]
							: parentPath
							? getMoveAtPath(moves, parentPath)
							: null;

					if (!removeMovesFromPath(moves, path)) return draft;

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

							return draft;
						}

						// Variations hang off the move before them, and the first move
						// has none. Saying so beats the move quietly not appearing.
						new Notice('The first move of a study cannot have variations.');

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
						new Notice(`Variations can only nest ${MAX_VARIATION_DEPTH} deep.`);
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
			new Notice('Saved.');
		} catch (e) {
			new Notice(`Could not save the study: ${e}`);
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
					const existing = body.findIndex((line) => /^\s*boardSize\s*:/.test(line));

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

			// Claiming the keys happens on any click in the study, the notes
			// editor and the buttons included: in Live Preview CodeMirror keeps
			// the focus for itself, so the click is the only record of where the
			// reader actually is.
			setActiveStudy(rootRef.current);

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

	const onDeleteMove = useCallback(
		(moveId: string) => {
			const moves = gameState.study.moves;
			const path = findMovePathById(moves, moveId);
			const list = path && getListAtPath(moves, path);

			if (!path || !list) return;

			const moveCount = countMoves(list.slice(path[path.length - 1]));

			if (!moveCount) return;

			// Same reasoning as deleting a variation: no undo, and autosave
			// commits it moments later.
			new ConfirmModal(app, {
				title: 'Delete move?',
				body: `This removes ${moveCount} ${
					moveCount === 1 ? 'move' : 'moves'
				} from this line, including any variations hanging off them. This cannot be undone.`,
				confirmText: 'Delete',
				onConfirm: () => dispatch({ type: 'DELETE_FROM_MOVE', moveId }),
			}).open();
		},
		[app, dispatch, gameState.study.moves]
	);

	/**
	 * Every move a drill can no longer reach, so the move list can grey the
	 * whole line rather than only the move the flag sits on.
	 */
	const excludedMoveIds = useMemo(
		() => collectExcludedMoveIds(gameState.study.moves),
		[gameState.study.moves]
	);

	/**
	 * Writes the map out as a canvas beside the note.
	 *
	 * A snapshot rather than a second copy of the study: nothing reads it back,
	 * and it goes stale the moment the study changes. That is the point - it is
	 * for spreading out and drawing on, which the map itself cannot be.
	 *
	 * An existing file is never overwritten; the name is suffixed instead, so a
	 * canvas you have already annotated survives a second export.
	 */
	const exportCanvas = useCallback(
		async (canvas: JsonCanvas) => {
			const folder = ctx.sourcePath.split('/').slice(0, -1).join('/');
			const base = (gameState.study.header?.title || 'Study map').replace(
				/[\\/:*?"<>|]/g,
				'-'
			);

			let path = normalizePath(`${folder ? `${folder}/` : ''}${base}.canvas`);

			for (
				let attempt = 2;
				app.vault.getAbstractFileByPath(path) && attempt < 100;
				attempt++
			)
				path = normalizePath(
					`${folder ? `${folder}/` : ''}${base} ${attempt}.canvas`
				);

			await app.vault.create(path, JSON.stringify(canvas, null, 2));

			new Notice(`Map exported to ${path}`);

			return path;
		},
		[app, ctx.sourcePath, gameState.study.header?.title]
	);

	/**
	 * Opens the study as a diagram.
	 *
	 * The side it reads for is the study's own when it has one, falling back to
	 * the way the board is turned - see `resolveStudyColor`.
	 */
	const onOpenMap = useCallback(() => {
		new MoveMapModal(app, {
			moves: gameState.study.moves,
			rootFEN: gameState.study.rootFEN,
			title: gameState.study.header?.title ?? null,
			currentMoveId: gameState.currentMove?.moveId ?? null,
			firstPlayer,
			initialMoveNumber,
			userColor: resolveStudyColor(gameState.study.playerColor, orientation),
			boardColor,
			loadStats: async () => (await dataAdapter.loadDrillData(chessStudyId)).stats,
			onSelectMove: (moveId: string) =>
				dispatch({ type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY', moveId }),
			onExport: exportCanvas,
		}).open();
	}, [
		app,
		boardColor,
		chessStudyId,
		dataAdapter,
		exportCanvas,
		dispatch,
		firstPlayer,
		gameState.currentMove?.moveId,
		gameState.study,
		initialMoveNumber,
		orientation,
	]);

	/**
	 * A shortcut the study wants, or false to let it pass.
	 *
	 * Preventing and stopping is the caller's business, not this function's:
	 * the same handler answers for a React event in Reading view and a native
	 * one caught before CodeMirror in Live Preview.
	 */
	const handleKey = useCallback(
		(event: KeyboardEvent): boolean => {
			// Never hijack keys while something is being typed into. Only fields
			// inside this study count: in Live Preview the study itself sits
			// inside the editor's own contenteditable, so asking for the nearest
			// editable ancestor without that check answers yes to every key and
			// the shortcuts go dead.
			const editable = (event.target as HTMLElement | null)?.closest?.(
				'input, textarea, [contenteditable="true"]'
			);

			if (editable && rootRef.current?.contains(editable)) return false;

			const shortcut = classificationForKey(event.key);

			if (shortcut) {
				dispatch({
					type: 'SET_CLASSIFICATION',
					classification: shortcut.classification,
				});

				return true;
			}

			switch (event.key) {
				case 'ArrowLeft':
					dispatch({ type: 'DISPLAY_PREVIOUS_MOVE_IN_HISTORY' });

					return true;
				case 'ArrowRight':
					dispatch({ type: 'DISPLAY_NEXT_MOVE_IN_HISTORY' });

					return true;
				case 'ArrowUp':
					dispatch({ type: 'DISPLAY_FIRST_MOVE_IN_HISTORY' });

					return true;
				case 'ArrowDown':
					dispatch({ type: 'DISPLAY_LAST_MOVE_IN_HISTORY' });

					return true;
				default:
					return false;
			}
		},
		[dispatch]
	);

	// On the register for as long as the study is on screen. Module-level, so a
	// Live Preview remount does not lose which study the reader is in.
	useEffect(() => {
		const root = rootRef.current;

		if (!root) return;

		return registerStudyKeys(root, handleKey);
	}, [handleKey]);

	const currentMoveId = gameState.currentMove?.moveId ?? null;

	const trainer = useTrainer({
		app,
		dataAdapter,
		chessStudyId,
		moves: gameState.study.moves,
		studyColor: gameState.study.playerColor,
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
			style={rootStyle}
			tabIndex={0}
			onKeyDown={(event) => {
				if (handleKey(event.nativeEvent)) {
					event.preventDefault();
					event.stopPropagation();
				}
			}}
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
						isViewOnly={trainer.isBoardLocked}
						// A session neither shows the arrows saved on a move nor
						// records any drawn during it: they are usually the plan, which
						// is the thing being asked, and writing them back would mean a
						// drill could edit the study.
						syncShapes={(shapes: DrawShape[]) => {
							if (trainer.isActive) return;

							dispatch({ type: 'SYNC_SHAPES', shapes });
						}}
						shapes={
							trainer.isActive ? NO_SHAPES : gameState.currentMove?.shapes ?? NO_SHAPES
						}
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
					onMapButtonClick={onOpenMap}
					onTitleChange={(title: string | null) =>
						dispatch({ type: 'SET_TITLE', title })
					}
					playerColor={gameState.study.playerColor}
					onPlayerColorChange={(color: 'w' | 'b') =>
						dispatch({ type: 'SET_PLAYER_COLOR', color })
					}
					onClassify={(moveId: string, classification: MoveClassification | null) =>
						dispatch({ type: 'SET_CLASSIFICATION', classification, moveId })
					}
					onVariationAction={onVariationAction}
					onDeleteMove={onDeleteMove}
					excludedMoveIds={excludedMoveIds}
					onSetExcluded={(moveId: string, excluded: boolean) =>
						dispatch({ type: 'SET_EXCLUDED', moveId, excluded })
					}
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
						setOrientation((current) => (current === 'white' ? 'black' : 'white'))
					}
					onMoveItemClick={(moveId: string) =>
						dispatch({
							type: 'DISPLAY_SELECTED_MOVE_IN_HISTORY',
							moveId: moveId,
						})
					}
					onSaveButtonClick={onSaveButtonClick}
					onExportButtonClick={() => {
						new ExportModal(app, {
							fen: chessLogic.fen(),
							pgn: exportPgn(
								gameState.study.moves,
								gameState.study.rootFEN,
								ROOT_FEN,
								gameState.study.header?.title ?? null
							),
						}).open();
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
