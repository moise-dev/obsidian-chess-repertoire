import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as React from 'react';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { collectExcludedMoveIds } from 'src/lib/drill';
import {
	MapSegment,
	buildSegments,
	fenToBoard,
	layoutSegments,
} from 'src/lib/move-map';
import { moveNumberAtPly } from 'src/lib/move-tree';
import { ChessStudyMove, MoveDrillStats } from 'src/lib/storage';

const CARD_WIDTH = 208;
const GAP_X = 56;
const GAP_Y = 18;
const DEFAULT_HEIGHT = 96;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const FIT_PADDING = 28;

const clamp = (value: number, low: number, high: number) =>
	Math.min(Math.max(value, low), high);

/**
 * Filled glyphs for both sides, coloured by CSS rather than by codepoint. The
 * outline glyphs for White vanish against a light square in half the themes
 * this plugin has to live in.
 */
const GLYPHS: Record<string, string> = {
	k: '♚',
	q: '♛',
	r: '♜',
	b: '♝',
	n: '♞',
	p: '♟',
};

const MiniBoard = ({ fen, flipped }: { fen: string; flipped: boolean }) => {
	const ranks = useMemo(() => {
		const board = fenToBoard(fen);

		return flipped ? board.map((rank) => [...rank].reverse()).reverse() : board;
	}, [fen, flipped]);

	return (
		<div className="cs-map-board" aria-hidden="true">
			{ranks.map((rank, rankIndex) =>
				rank.map((piece, fileIndex) => (
					<div
						key={`${rankIndex}-${fileIndex}`}
						className={`cs-map-square ${
							(rankIndex + fileIndex) % 2 ? 'is-dark' : 'is-light'
						}`}
					>
						{piece && (
							<span
								className={`cs-map-piece ${
									piece === piece.toUpperCase() ? 'is-white' : 'is-black'
								}`}
							>
								{GLYPHS[piece.toLowerCase()]}
							</span>
						)}
					</div>
				))
			)}
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

const stateTitle = (state: SegmentState) => {
	if (state.isExcluded) return 'Excluded from drills';
	if (state.isHole) return 'No reply recorded yet';
	if (!state.attempts) return 'Never drilled';

	return `${state.misses} missed of ${state.attempts} drilled`;
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
	loadStats: () => Promise<Record<string, MoveDrillStats>>;
	onSelectMove: (moveId: string) => void;
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
	loadStats,
	onSelectMove,
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
				1
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
						const last = segment.moves[segment.moves.length - 1];
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
									<span className="cs-map-card-count">
										{segment.moves.length} {segment.moves.length === 1 ? 'move' : 'moves'}
									</span>
								</div>

								<div className="cs-map-card-body">
									<MiniBoard
										fen={last ? last.after : rootFEN}
										flipped={userColor === 'b'}
									/>

									<div className="cs-map-moves">
										{segment.moves.map((move, index) => {
											const number = moveNumberAtPly(
												segment.startPly + index,
												firstPlayer,
												initialMoveNumber
											);
											const indicator =
												move.color === 'w'
													? `${number}.`
													: index === 0
													? `${number}...`
													: null;

											return (
												<button
													key={move.moveId}
													className={`cs-map-move${
														move.moveId === currentMoveId ? ' is-current' : ''
													}${excluded.has(move.moveId) ? ' is-undrilled' : ''}`}
													title="Show this move on the board"
													onClick={() => onMoveClick(move.moveId)}
												>
													{indicator && (
														<span className="cs-map-move-number">{indicator}</span>
													)}
													{move.san}
												</button>
											);
										})}
									</div>
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
