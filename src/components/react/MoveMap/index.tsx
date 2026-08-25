import { LayoutGrid, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as React from 'react';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { BoardColor } from 'src/components/obsidian/SettingsTab';
import { CanvasCard, JsonCanvas, toCanvas } from 'src/lib/canvas';
import { collectExcludedMoveIds } from 'src/lib/drill';
import {
	MapSegment,
	Transposition,
	anchorMove,
	buildSegments,
	fenToBoard,
	findTranspositions,
	layoutSegments,
	toScoresheet,
} from 'src/lib/move-map';
import { moveNumberAtPly } from 'src/lib/move-tree';
import { ChessStudyMove, MoveDrillStats } from 'src/lib/storage';

const CARD_WIDTH = 248;
const GAP_X = 64;
const GAP_Y = 20;
const DEFAULT_HEIGHT = 180;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
/**
 * Fitting may zoom in as well as out, but only so far: a study of two cards
 * should fill the space rather than sit marooned in the middle of it, and
 * blowing those two up to fill a 1400px modal is no better.
 */
const MAX_FIT_ZOOM = 1.4;
const FIT_PADDING = 32;

const clamp = (value: number, low: number, high: number) =>
	Math.min(Math.max(value, low), high);

/** Which position a card's board is showing, for its tooltip. */
const positionLabel = (move: ChessStudyMove | null, number: number) => {
	if (!move) return 'Starting position';

	return `After ${number}${move.color === 'b' ? '...' : '.'} ${move.san}`;
};

/** FEN letter to the role name chessground keys its sprites by. */
const ROLES: Record<string, string> = {
	k: 'king',
	q: 'queen',
	r: 'rook',
	b: 'bishop',
	n: 'knight',
	p: 'pawn',
};

/**
 * One piece, drawn with the same sprite the real board uses.
 *
 * `piece` is chessground's own element and JSX has no type for it, hence
 * `createElement`. Reaching for the sprites rather than the Unicode chess
 * glyphs because font coverage of those is patchy - the pawns arrive and the
 * pieces come back as empty boxes - and because a map of a study should not
 * show a different set of pieces from the study.
 */
const Piece = ({ role, color }: { role: string; color: string }) =>
	React.createElement('piece', { className: `${role} ${color}` });

const MiniBoard = ({
	fen,
	flipped,
	boardColor,
	label,
}: {
	fen: string;
	flipped: boolean;
	boardColor: BoardColor;
	/** Which position this is, since a card no longer always shows its last. */
	label: string;
}) => {
	const ranks = useMemo(() => {
		const board = fenToBoard(fen);

		return flipped ? board.map((rank) => [...rank].reverse()).reverse() : board;
	}, [fen, flipped]);

	// `cg-wrap` on the outside is what lets chessground's sprite rules find the
	// pieces; the grid itself carries the board colours.
	return (
		<div className="cs-map-board-wrap cg-wrap" title={label}>
			<div className={`cs-map-board ${boardColor}-board`} aria-hidden="true">
				{ranks.map((rank, rankIndex) =>
					rank.map((piece, fileIndex) => (
						<div
							key={`${rankIndex}-${fileIndex}`}
							className={`cs-map-square ${
								(rankIndex + fileIndex) % 2 ? 'is-dark' : 'is-light'
							}`}
						>
							{piece && (
								<Piece
									role={ROLES[piece.toLowerCase()]}
									color={piece === piece.toUpperCase() ? 'white' : 'black'}
								/>
							)}
						</div>
					))
				)}
			</div>
		</div>
	);
};

/** How well the moves you own inside one segment have held up under drilling. */
interface SegmentState {
	/** No drill can reach this segment. */
	isExcluded: boolean;
	/** The line stops on the opponent's move: nothing answers it yet. */
	isHole: boolean;
	attempts: number;
	misses: number;
}

const segmentState = (
	segment: MapSegment,
	excluded: Set<string>,
	stats: Record<string, MoveDrillStats>,
	userColor: 'w' | 'b'
): SegmentState => {
	const last = segment.moves[segment.moves.length - 1];
	const own = segment.moves.filter((move) => move.color === userColor);

	return {
		isExcluded: excluded.has(segment.moves[0].moveId),
		isHole: !segment.children.length && !!last && last.color !== userColor,
		attempts: own.reduce(
			(total, move) => total + (stats[move.moveId]?.attempts ?? 0),
			0
		),
		misses: own.reduce(
			(total, move) => total + (stats[move.moveId]?.misses ?? 0),
			0
		),
	};
};

const stateClass = ({ isExcluded, isHole, attempts, misses }: SegmentState) => {
	if (isExcluded) return 'is-excluded';
	if (isHole) return 'is-hole';
	if (!attempts) return 'is-untested';

	return misses / attempts > 0.25 ? 'is-shaky' : 'is-known';
};

/** Canvas's preset colours, for the states worth colouring. */
const STATE_COLORS: Record<string, string> = {
	'is-hole': '1',
	'is-shaky': '2',
	'is-known': '4',
};

const stateTitle = (state: SegmentState) => {
	if (state.isExcluded) return 'Excluded from drills';
	if (state.isHole) return 'No reply recorded yet';
	if (!state.attempts) return 'Never drilled';

	return `${state.misses} missed of ${state.attempts} drilled`;
};

/**
 * Says that this move reaches a position another line reaches too, and takes
 * you there. Drawn on the move rather than on the card because a card holds a
 * dozen positions and only one of them transposes.
 */
const TranspositionMark = ({
	elsewhere,
	onFollow,
}: {
	elsewhere: Transposition[] | undefined;
	onFollow: (segmentId: string) => void;
}) => {
	if (!elsewhere?.length) return null;

	const [first] = elsewhere;

	return (
		<button
			className="cs-map-transposition"
			title={`Also reached after ${first.san}${
				elsewhere.length > 1 ? `, and ${elsewhere.length - 1} more` : ''
			} - click to go there`}
			onClick={() => onFollow(first.segmentId)}
		>
			{'\u21c4'}
		</button>
	);
};

interface MoveMapProps {
	moves: ChessStudyMove[];
	rootFEN: string;
	title: string | null;
	currentMoveId: string | null;
	firstPlayer: string;
	initialMoveNumber: number;
	/** The side the study is written for, taken from the board's orientation. */
	userColor: 'w' | 'b';
	/** The study's own board theme, so the map does not show a different one. */
	boardColor: BoardColor;
	loadStats: () => Promise<Record<string, MoveDrillStats>>;
	onSelectMove: (moveId: string) => void;
	/** Writes the diagram out as a canvas file, answering where it went. */
	onExport: (canvas: JsonCanvas) => Promise<string>;
}

/**
 * The study as a diagram: one card per run of moves with no choice in it, and a
 * fork wherever the line branches.
 *
 * Read left to right, a card is a stretch of play nobody had to decide anything
 * in, and the columns are the points where the opponent did. That is the shape
 * a repertoire actually has, and it is the one thing the move list cannot show:
 * there, a branch is an indent that could be one move or forty.
 */
export const MoveMap = ({
	moves,
	rootFEN,
	title,
	currentMoveId,
	firstPlayer,
	initialMoveNumber,
	userColor,
	boardColor,
	loadStats,
	onSelectMove,
	onExport,
}: MoveMapProps) => {
	const [stats, setStats] = useState<Record<string, MoveDrillStats>>({});
	const [heights, setHeights] = useState<Record<string, number>>({});
	const [view, setView] = useState({ x: 0, y: 0, z: 1 });

	const viewportRef = useRef<HTMLDivElement>(null);
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const hasFitted = useRef(false);
	const panned = useRef(false);

	// The diagram draws without them and colours in when they arrive; a study
	// never drilled has none to wait for.
	useEffect(() => {
		let cancelled = false;

		loadStats().then((loaded) => {
			if (!cancelled) setStats(loaded);
		});

		return () => {
			cancelled = true;
		};
	}, [loadStats]);

	const root = useMemo(() => buildSegments(moves), [moves]);
	const excluded = useMemo(() => collectExcludedMoveIds(moves), [moves]);
	const transpositions = useMemo(
		() => (root ? findTranspositions(root) : new Map()),
		[root]
	);

	const layout = useMemo(() => {
		if (!root) return null;

		return layoutSegments(root, heights, {
			cardWidth: CARD_WIDTH,
			gapX: GAP_X,
			gapY: GAP_Y,
			defaultHeight: DEFAULT_HEIGHT,
		});
	}, [heights, root]);

	// Cards size themselves to their content, so the packing needs their real
	// heights. Measure after paint and lay out again if anything moved.
	useLayoutEffect(() => {
		const measured: Record<string, number> = {};
		let changed = false;

		for (const [id, element] of cardRefs.current) {
			measured[id] = element.offsetHeight;

			if (heights[id] !== measured[id]) changed = true;
		}

		if (changed || Object.keys(heights).length !== cardRefs.current.size)
			setHeights(measured);
		// Keyed on the layout, which changes whenever the cards do - through
		// `root` when the study changes, through `heights` when a measurement
		// lands. Measuring the same cards twice settles rather than loops.
	}, [heights, layout]);

	const fit = useCallback(() => {
		const viewport = viewportRef.current;

		if (!viewport || !layout) return;

		const zoom = clamp(
			Math.min(
				(viewport.clientWidth - FIT_PADDING * 2) / layout.width,
				(viewport.clientHeight - FIT_PADDING * 2) / layout.height,
				MAX_FIT_ZOOM
			),
			MIN_ZOOM,
			MAX_ZOOM
		);

		setView({
			z: zoom,
			x: (viewport.clientWidth - layout.width * zoom) / 2,
			y: (viewport.clientHeight - layout.height * zoom) / 2,
		});
	}, [layout]);

	// Frame the whole thing once, after the first measured layout rather than
	// the guessed one, then leave the view alone.
	useEffect(() => {
		if (hasFitted.current || !layout || !Object.keys(heights).length) return;

		hasFitted.current = true;
		fit();
	}, [fit, heights, layout]);

	// Native listener rather than onWheel: React attaches wheel handlers
	// passively, and a passive one cannot stop the modal scrolling underneath.
	useEffect(() => {
		const viewport = viewportRef.current;

		if (!viewport) return;

		const onWheel = (event: WheelEvent) => {
			event.preventDefault();

			const rect = viewport.getBoundingClientRect();
			const pointerX = event.clientX - rect.left;
			const pointerY = event.clientY - rect.top;

			setView((current) => {
				const zoom = clamp(
					current.z * Math.exp(-event.deltaY * 0.0015),
					MIN_ZOOM,
					MAX_ZOOM
				);
				const ratio = zoom / current.z;

				// Keep whatever is under the pointer under the pointer.
				return {
					z: zoom,
					x: pointerX - (pointerX - current.x) * ratio,
					y: pointerY - (pointerY - current.y) * ratio,
				};
			});
		};

		viewport.addEventListener('wheel', onWheel, { passive: false });

		return () => viewport.removeEventListener('wheel', onWheel);
	}, []);

	const onPointerDown = useCallback((event: React.PointerEvent) => {
		if (event.button !== 0) return;

		const startX = event.clientX;
		const startY = event.clientY;

		panned.current = false;

		const onPointerMove = (moveEvent: PointerEvent) => {
			const dx = moveEvent.clientX - startX;
			const dy = moveEvent.clientY - startY;

			// A few pixels of slop, so a click that wobbles is still a click.
			if (!panned.current && Math.abs(dx) + Math.abs(dy) < 4) return;

			panned.current = true;

			setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
	}, []);

	/**
	 * Brings a card to the middle of the viewport at the current zoom. Following
	 * a transposition is navigation inside the diagram, so the map neither
	 * closes nor rescales - only the view moves.
	 */
	const focusSegment = useCallback(
		(segmentId: string) => {
			const viewport = viewportRef.current;
			const node = layout?.nodes.find(
				(candidate) => candidate.segment.id === segmentId
			);

			if (!viewport || !node) return;

			setView((current) => ({
				...current,
				x: viewport.clientWidth / 2 - (node.x + CARD_WIDTH / 2) * current.z,
				y: viewport.clientHeight / 2 - (node.y + node.height / 2) * current.z,
			}));
		},
		[layout]
	);

	const zoomBy = useCallback((factor: number) => {
		const viewport = viewportRef.current;

		if (!viewport) return;

		const centreX = viewport.clientWidth / 2;
		const centreY = viewport.clientHeight / 2;

		setView((current) => {
			const zoom = clamp(current.z * factor, MIN_ZOOM, MAX_ZOOM);
			const ratio = zoom / current.z;

			return {
				z: zoom,
				x: centreX - (centreX - current.x) * ratio,
				y: centreY - (centreY - current.y) * ratio,
			};
		});
	}, []);

	/**
	 * The same facts the cards are drawn from, in the shape the canvas writer
	 * wants. Built here rather than in the writer so the file says exactly what
	 * the diagram says.
	 */
	const canvasCards = useMemo((): CanvasCard[] => {
		if (!layout) return [];

		return layout.nodes.map(({ segment }) => {
			const state = segmentState(segment, excluded, stats, userColor);
			const rows = toScoresheet(segment, (ply) =>
				moveNumberAtPly(ply, firstPlayer, initialMoveNumber)
			);

			return {
				segmentId: segment.id,
				range:
					rows[0].number === rows[rows.length - 1].number
						? `${rows[0].number}`
						: `${rows[0].number}\u2013${rows[rows.length - 1].number}`,
				moves: rows
					.map((row) =>
						[`${row.number}.`, row.white?.san ?? '...', row.black?.san]
							.filter(Boolean)
							.join(' ')
					)
					.join('  '),
				state: stateTitle(state),
				color: STATE_COLORS[stateClass(state)],
			};
		});
	}, [excluded, firstPlayer, initialMoveNumber, layout, stats, userColor]);

	const onExportClick = useCallback(async () => {
		if (!layout) return;

		await onExport(toCanvas(layout, canvasCards, { cardWidth: CARD_WIDTH }));
	}, [canvasCards, layout, onExport]);

	const onMoveClick = useCallback(
		(moveId: string) => {
			// The pointer that just finished a pan is not choosing a move.
			if (panned.current) return;

			onSelectMove(moveId);
		},
		[onSelectMove]
	);

	if (!root || !layout)
		return (
			<div className="cs-map">
				<p className="cs-empty-state">
					This study has no moves to map yet. Play a move on the board to start the
					line.
				</p>
			</div>
		);

	return (
		<div className="cs-map">
			<div className="cs-map-toolbar">
				<span className="cs-map-title">{title || 'Study map'}</span>
				<span className="cs-map-legend">
					<span className="cs-map-key is-known" /> drilled
					<span className="cs-map-key is-shaky" /> shaky
					<span className="cs-map-key is-untested" /> new
					<span className="cs-map-key is-hole" /> no reply
					<span className="cs-map-key is-excluded" /> excluded
					<span className="cs-map-key is-transposition">{'\u21c4'}</span> transposes
				</span>
				<span className="cs-map-spacer" />
				<button
					className="cs-icon-button"
					title="Zoom out"
					onClick={() => zoomBy(1 / 1.25)}
				>
					<ZoomOut size={16} />
				</button>
				<button
					className="cs-icon-button"
					title="Zoom in"
					onClick={() => zoomBy(1.25)}
				>
					<ZoomIn size={16} />
				</button>
				<button className="cs-icon-button" title="Fit to view" onClick={fit}>
					<Maximize2 size={16} />
				</button>
				<button
					className="cs-icon-button"
					title="Export as an Obsidian canvas"
					onClick={onExportClick}
				>
					<LayoutGrid size={16} />
				</button>
			</div>

			<div
				className="cs-map-viewport"
				ref={viewportRef}
				onPointerDown={onPointerDown}
			>
				<div
					className="cs-map-world"
					style={{
						transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
					}}
				>
					<svg className="cs-map-edges" width={layout.width} height={layout.height}>
						{layout.edges.map(({ from, to }) => {
							const x1 = from.x + CARD_WIDTH;
							const y1 = from.y + from.height / 2;
							const x2 = to.x;
							const y2 = to.y + to.height / 2;
							const bend = GAP_X / 2;

							return (
								<path
									key={`${from.segment.id}-${to.segment.id}`}
									className="cs-map-edge"
									d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${
										x2 - bend
									} ${y2}, ${x2} ${y2}`}
								/>
							);
						})}
					</svg>

					{layout.nodes.map((node) => {
						const { segment } = node;
						const state = segmentState(segment, excluded, stats, userColor);
						// The trunk's board is its last position; every branch shows the
						// move that opened it.
						const anchor = anchorMove(segment);
						const anchorPly =
							segment.depth === 0
								? segment.startPly + segment.moves.length - 1
								: segment.startPly;
						const anchorLabel = positionLabel(
							anchor,
							moveNumberAtPly(anchorPly, firstPlayer, initialMoveNumber)
						);
						const rows = toScoresheet(segment, (ply) =>
							moveNumberAtPly(ply, firstPlayer, initialMoveNumber)
						);
						const holdsCurrent = segment.moves.some(
							(move) => move.moveId === currentMoveId
						);

						return (
							<div
								key={segment.id}
								ref={(element) => {
									if (element) cardRefs.current.set(segment.id, element);
									else cardRefs.current.delete(segment.id);
								}}
								className={`cs-map-card ${stateClass(state)}${
									holdsCurrent ? ' is-current' : ''
								}`}
								style={{
									left: node.x,
									top: node.y,
									width: CARD_WIDTH,
								}}
							>
								<div className="cs-map-card-head" title={stateTitle(state)}>
									<span className="cs-map-card-state" />
									<span className="cs-map-card-range">
										{rows[0].number === rows[rows.length - 1].number
											? rows[0].number
											: `${rows[0].number}\u2013${rows[rows.length - 1].number}`}
									</span>
									<span className="cs-map-card-count">
										{segment.moves.length} {segment.moves.length === 1 ? 'move' : 'moves'}
									</span>
								</div>

								<MiniBoard
									fen={anchor ? anchor.after : rootFEN}
									flipped={userColor === 'b'}
									boardColor={boardColor}
									label={anchorLabel}
								/>

								<div className="cs-map-sheet">
									{rows.map((row) => (
										<React.Fragment key={row.number}>
											<span className="cs-map-sheet-number">{row.number}.</span>
											{[row.white, row.black].map((move, column) =>
												move ? (
													<span className="cs-map-cell" key={move.moveId}>
														<button
															className={`cs-map-move${
																move.moveId === currentMoveId ? ' is-current' : ''
															}${excluded.has(move.moveId) ? ' is-undrilled' : ''}`}
															title="Show this move on the board"
															onClick={() => onMoveClick(move.moveId)}
														>
															{move.san}
														</button>
														<TranspositionMark
															elsewhere={transpositions.get(move.moveId)}
															onFollow={focusSegment}
														/>
													</span>
												) : (
													<span key={column} className="cs-map-sheet-gap" aria-hidden="true">
														{'\u2026'}
													</span>
												)
											)}
										</React.Fragment>
									))}
								</div>

								{state.isHole && (
									<p className="cs-map-card-note">No reply recorded yet.</p>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
};
