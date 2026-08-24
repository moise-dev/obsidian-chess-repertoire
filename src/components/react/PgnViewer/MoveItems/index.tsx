import { JSONContent } from '@tiptap/react';
import { DrawShape } from 'chessground/draw';
import { Menu } from 'obsidian';
import * as React from 'react';
import {
	CLASSIFICATION_ORDER,
	CLASSIFICATIONS,
	MoveClassification,
	readClassification,
} from 'src/lib/classification';
import { commentToPlainText, hasComment } from 'src/lib/comments';

const useScrollIntoView = <T extends HTMLElement>(isCurrentMove: boolean) => {
	const ref = React.useRef<T>(null);

	React.useEffect(() => {
		if (!isCurrentMove) return;

		ref.current?.scrollIntoView({
			behavior: 'smooth',
			block: 'nearest',
			inline: 'end',
		});
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
}

/**
 * What was annotated on this move, at a glance: the classification badge, an
 * accent dot for a note, a green dot for board arrows.
 */
const Markers = ({ comment, shapes, classification }: MoveAnnotations) => {
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
		</>
	);
};

const annotationTitle = ({ comment }: MoveAnnotations) =>
	hasComment(comment) ? commentToPlainText(comment) : undefined;

const annotationClass = ({ comment, shapes }: MoveAnnotations) =>
	`${hasComment(comment) ? ' has-note' : ''}${
		shapes?.length ? ' has-shapes' : ''
	}`;

/**
 * Right-click menu: labelling for any move, plus the variation operations for
 * moves that sit inside one. Reaching these from the move list means they work
 * whether or not the notes panel is open.
 */
const useMoveMenu = (
	classification: MoveClassification | null | undefined,
	onClassify?: (classification: MoveClassification | null) => void,
	variation?: VariationPosition,
	onVariationAction?: (action: VariationAction) => void
) =>
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
		[classification, onClassify, onVariationAction, variation]
	);

interface MoveItemProps extends MoveAnnotations {
	isCurrentMove: boolean;
	san: string;
	onMoveItemClick: () => void;
	onClassify?: (classification: MoveClassification | null) => void;
}

export const MoveItem = ({
	isCurrentMove,
	san,
	comment,
	shapes,
	classification,
	onMoveItemClick,
	onClassify,
}: MoveItemProps) => {
	const ref = useScrollIntoView<HTMLParagraphElement>(isCurrentMove);
	const onContextMenu = useMoveMenu(classification, onClassify);

	return (
		<p
			className={`move-item ${isCurrentMove ? 'active' : ''}${annotationClass({
				comment,
				shapes,
			})} vertical-align`}
			ref={ref}
			title={annotationTitle({ comment })}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
			onContextMenu={onContextMenu}
		>
			{san}
			<Markers comment={comment} shapes={shapes} classification={classification} />
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
	onMoveItemClick,
	onClassify,
	variation,
	onVariationAction,
	moveIndicator = null,
}: VariantMoveItemProps) => {
	const ref = useScrollIntoView<HTMLDivElement>(isCurrentMove);
	const onContextMenu = useMoveMenu(
		classification,
		onClassify,
		variation,
		onVariationAction
	);

	return (
		<div
			className={`variant-move-item ${
				isCurrentMove ? 'active' : ''
			}${annotationClass({ comment, shapes })}`}
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
			<Markers comment={comment} shapes={shapes} classification={classification} />
		</div>
	);
};
