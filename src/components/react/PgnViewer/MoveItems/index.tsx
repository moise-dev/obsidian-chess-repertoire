import { JSONContent } from '@tiptap/react';
import { DrawShape } from 'chessground/draw';
import { Menu } from 'obsidian';
import * as React from 'react';
import {
	CLASSIFICATION_ORDER,
	CLASSIFICATIONS,
	DRAW_MARK,
	MoveClassification,
	readClassification,
} from 'src/lib/classification';
import { commentToPlainText, hasComment } from 'src/lib/comments';
import { scrollOffsetToShow } from 'src/lib/scroll';

/** The moves panel's own scrolling box, and the only thing that may scroll. */
const MOVE_LIST = '.move-item-section';

/**
 * Keeps the current move in view inside the move list, and moves nothing else.
 *
 * Deliberately not `scrollIntoView`: that scrolls every scrollable ancestor,
 * the note itself included, so following a long line took the board off the
 * screen. Setting the list's own `scrollTop` cannot reach past the list.
 */
const useScrollIntoView = <T extends HTMLElement>(isCurrentMove: boolean) => {
	const ref = React.useRef<T>(null);

	React.useEffect(() => {
		if (!isCurrentMove) return;

		const move = ref.current;
		const list = move?.closest<HTMLElement>(MOVE_LIST);

		if (!move || !list) return;

		const offset = scrollOffsetToShow(
			move.getBoundingClientRect(),
			list.getBoundingClientRect()
		);

		if (offset)
			list.scrollTo({ top: list.scrollTop + offset, behavior: 'smooth' });
	}, [isCurrentMove]);

	return ref;
};

export type VariationAction =
	| 'promote'
	| 'promote-to-mainline'
	| 'move-up'
	| 'move-down'
	| 'delete';

/** Where a variation move sits, so its menu can offer only what applies. */
export interface VariationPosition {
	depth: number;
	index: number;
	siblingCount: number;
}

interface MoveAnnotations {
	comment?: JSONContent | null;
	shapes?: DrawShape[];
	classification?: MoveClassification | null;
	/** The flag sits on this move, rather than on one earlier in the line. */
	excluded?: boolean;
	/** The position it reaches is drawn. Read from the board, never set. */
	isDraw?: boolean;
}

/**
 * What was annotated on this move, at a glance: the classification badge, an
 * accent dot for a note, a green dot for board arrows.
 */
const Markers = ({
	comment,
	shapes,
	classification,
	excluded,
	isDraw,
}: MoveAnnotations) => {
	// Guarded: a hand-edited file could name a label this build does not have.
	const known = readClassification(classification);

	return (
		<>
			{known && (
				<span
					className="cs-move-classification"
					style={
						{
							'--cs-classification': CLASSIFICATIONS[known].color,
						} as React.CSSProperties
					}
					title={CLASSIFICATIONS[known].label}
				>
					{CLASSIFICATIONS[known].glyph}
				</span>
			)}
			{/* After the label rather than instead of it: a move can be a blunder
			    and still be the one that draws. */}
			{isDraw && (
				<span
					className="cs-move-classification"
					style={{ '--cs-classification': DRAW_MARK.color } as React.CSSProperties}
					title={DRAW_MARK.label}
				>
					{DRAW_MARK.glyph}
				</span>
			)}
			{hasComment(comment) && (
				<span className="cs-move-marker cs-move-marker--note" aria-hidden="true" />
			)}
			{!!shapes?.length && (
				<span
					className="cs-move-marker cs-move-marker--shape"
					title={`${shapes.length} board ${
						shapes.length === 1 ? 'arrow' : 'arrows'
					}`}
				/>
			)}
			{/* Only where the flag actually sits: the ring says where the line
			    stops being drilled, the dimming says how far that reaches. */}
			{excluded && (
				<span
					className="cs-move-marker cs-move-marker--excluded"
					title="Drills stop here"
				/>
			)}
		</>
	);
};

const annotationTitle = ({ comment }: MoveAnnotations) =>
	hasComment(comment) ? commentToPlainText(comment) : undefined;

const annotationClass = ({ comment, shapes }: MoveAnnotations) =>
	`${hasComment(comment) ? ' has-note' : ''}${
		shapes?.length ? ' has-shapes' : ''
	}`;

/** Marks the whole span a drill can no longer reach, not only the flagged move. */
const undrilledClass = (isUndrilled?: boolean) =>
	isUndrilled ? ' is-undrilled' : '';

interface MoveMenuOptions {
	classification: MoveClassification | null | undefined;
	onClassify?: (classification: MoveClassification | null) => void;
	/** Delete this move and the rest of its line. */
	onDeleteMove?: () => void;
	excluded?: boolean;
	onSetExcluded?: (excluded: boolean) => void;
	variation?: VariationPosition;
	onVariationAction?: (action: VariationAction) => void;
}

/**
 * Right-click menu: labelling and deletion for any move, plus the variation
 * operations for moves that sit inside one. Reaching these from the move list
 * means they work whether or not the notes panel is open.
 */
const useMoveMenu = ({
	classification,
	onClassify,
	onDeleteMove,
	excluded,
	onSetExcluded,
	variation,
	onVariationAction,
}: MoveMenuOptions) =>
	React.useCallback(
		(event: React.MouseEvent) => {
			if (!onClassify) return;

			// Otherwise Obsidian's own editor menu opens on top of ours.
			event.preventDefault();
			event.stopPropagation();

			const menu = new Menu();

			for (const key of CLASSIFICATION_ORDER) {
				const { label, glyph, shortcut } = CLASSIFICATIONS[key];

				menu.addItem((item) =>
					item
						.setTitle(`${glyph}  ${label}  (${shortcut})`)
						.setChecked(classification === key)
						.onClick(() => onClassify(classification === key ? null : key))
				);
			}

			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle('Clear classification')
					.setIcon('x')
					.setDisabled(!classification)
					.onClick(() => onClassify(null))
			);

			if (onSetExcluded) {
				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle('Exclude from drills')
						.setIcon('ban')
						.setChecked(!!excluded)
						.onClick(() => onSetExcluded(!excluded))
				);
			}

			if (onDeleteMove) {
				menu.addSeparator();
				menu.addItem((item) =>
					item.setTitle('Delete move').setIcon('scissors').onClick(onDeleteMove)
				);
			}

			if (variation && onVariationAction) {
				menu.addSeparator();

				menu.addItem((item) =>
					item
						.setTitle('Promote to mainline')
						.setIcon('chevrons-up')
						.onClick(() => onVariationAction('promote-to-mainline'))
				);

				// Only meaningful below the first level; at depth 1 it is the same
				// thing as promoting to the mainline.
				if (variation.depth > 1) {
					menu.addItem((item) =>
						item
							.setTitle('Promote one level')
							.setIcon('chevron-up')
							.onClick(() => onVariationAction('promote'))
					);
				}

				if (variation.siblingCount > 1) {
					menu.addItem((item) =>
						item
							.setTitle('Move variation up')
							.setIcon('arrow-up')
							.setDisabled(variation.index === 0)
							.onClick(() => onVariationAction('move-up'))
					);
					menu.addItem((item) =>
						item
							.setTitle('Move variation down')
							.setIcon('arrow-down')
							.setDisabled(variation.index === variation.siblingCount - 1)
							.onClick(() => onVariationAction('move-down'))
					);
				}

				menu.addSeparator();
				menu.addItem((item) =>
					item
						.setTitle('Delete variation')
						.setIcon('trash-2')
						.onClick(() => onVariationAction('delete'))
				);
			}

			menu.showAtMouseEvent(event.nativeEvent);
		},
		[
			classification,
			excluded,
			onClassify,
			onDeleteMove,
			onSetExcluded,
			onVariationAction,
			variation,
		]
	);

interface MoveItemProps extends MoveAnnotations {
	isCurrentMove: boolean;
	san: string;
	/** Out of drills, whether by its own flag or one earlier in the line. */
	isUndrilled?: boolean;
	onMoveItemClick: () => void;
	onClassify?: (classification: MoveClassification | null) => void;
	onDeleteMove?: () => void;
	onSetExcluded?: (excluded: boolean) => void;
}

export const MoveItem = ({
	isCurrentMove,
	san,
	comment,
	shapes,
	classification,
	excluded,
	isDraw,
	isUndrilled,
	onMoveItemClick,
	onClassify,
	onDeleteMove,
	onSetExcluded,
}: MoveItemProps) => {
	const ref = useScrollIntoView<HTMLParagraphElement>(isCurrentMove);
	const onContextMenu = useMoveMenu({
		classification,
		onClassify,
		onDeleteMove,
		excluded,
		onSetExcluded,
	});

	return (
		<p
			className={`move-item ${isCurrentMove ? 'active' : ''}${annotationClass({
				comment,
				shapes,
			})}${undrilledClass(isUndrilled)} vertical-align`}
			ref={ref}
			title={annotationTitle({ comment })}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
			onContextMenu={onContextMenu}
		>
			{san}
			<Markers
				comment={comment}
				shapes={shapes}
				classification={classification}
				excluded={excluded}
				isDraw={isDraw}
			/>
		</p>
	);
};

interface VariantMoveItemProps extends MoveItemProps {
	moveIndicator?: string | null;
	variation?: VariationPosition;
	onVariationAction?: (action: VariationAction) => void;
}

export const VariantMoveItem = ({
	isCurrentMove,
	san,
	comment,
	shapes,
	classification,
	excluded,
	isDraw,
	isUndrilled,
	onMoveItemClick,
	onClassify,
	onDeleteMove,
	onSetExcluded,
	variation,
	onVariationAction,
	moveIndicator = null,
}: VariantMoveItemProps) => {
	const ref = useScrollIntoView<HTMLDivElement>(isCurrentMove);
	const onContextMenu = useMoveMenu({
		classification,
		onClassify,
		onDeleteMove,
		excluded,
		onSetExcluded,
		variation,
		onVariationAction,
	});

	return (
		<div
			className={`variant-move-item ${
				isCurrentMove ? 'active' : ''
			}${annotationClass({ comment, shapes })}${undrilledClass(isUndrilled)}`}
			title={annotationTitle({ comment })}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
			onContextMenu={onContextMenu}
			ref={ref}
		>
			<span className="variant-move-indicator">{moveIndicator}</span>
			{san}
			<Markers
				comment={comment}
				shapes={shapes}
				classification={classification}
				excluded={excluded}
				isDraw={isDraw}
			/>
		</div>
	);
};
