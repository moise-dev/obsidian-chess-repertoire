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

const useScrollIntoView = (isCurrentMove: boolean) => {
	const ref = React.useRef<HTMLElement>(null);

	React.useEffect(() => {
		if (ref.current && isCurrentMove) {
			ref.current?.scrollIntoView({
				behavior: 'smooth',
				block: 'nearest',
				inline: 'end',
			});
		}
	}, [isCurrentMove]);

	return ref;
};

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
	// Read through the guard: a hand-edited or newer-version file could carry a
	// label this build does not know, and indexing the table blindly would throw.
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
 * Right-click menu for labelling a move without going through the notes panel,
 * which may well be collapsed.
 */
const useClassificationMenu = (
	classification: MoveClassification | null | undefined,
	onClassify?: (classification: MoveClassification | null) => void
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

			menu.showAtMouseEvent(event.nativeEvent);
		},
		[classification, onClassify]
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
	const ref = useScrollIntoView(isCurrentMove);
	const onContextMenu = useClassificationMenu(classification, onClassify);

	return (
		<p
			className={`move-item ${
				(isCurrentMove && 'active') || ''
			}${annotationClass({ comment, shapes })} vertical-align`}
			ref={ref as React.RefObject<HTMLParagraphElement>}
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
}

export const VariantMoveItem = ({
	isCurrentMove,
	san,
	comment,
	shapes,
	classification,
	onMoveItemClick,
	onClassify,
	moveIndicator = null,
}: VariantMoveItemProps) => {
	const ref = useScrollIntoView(isCurrentMove);
	const onContextMenu = useClassificationMenu(classification, onClassify);

	return (
		<div
			className={`variant-move-item ${
				(isCurrentMove && 'active') || ''
			}${annotationClass({ comment, shapes })}`}
			title={annotationTitle({ comment })}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
			onContextMenu={onContextMenu}
			ref={ref as React.RefObject<HTMLDivElement>}
		>
			<span className="variant-move-indicator">{moveIndicator}</span>
			{san}
			<Markers comment={comment} shapes={shapes} classification={classification} />
		</div>
	);
};
