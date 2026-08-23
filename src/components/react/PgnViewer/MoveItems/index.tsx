import { JSONContent } from '@tiptap/react';
import { DrawShape } from 'chessground/draw';
import * as React from 'react';
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
}

/**
 * Dots showing, at a glance, which moves were annotated: accent for a note,
 * green for board arrows.
 */
const Markers = ({ comment, shapes }: MoveAnnotations) => (
	<>
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

const annotationTitle = ({ comment }: MoveAnnotations) =>
	hasComment(comment) ? commentToPlainText(comment) : undefined;

const annotationClass = ({ comment, shapes }: MoveAnnotations) =>
	`${hasComment(comment) ? ' has-note' : ''}${shapes?.length ? ' has-shapes' : ''}`;

interface MoveItemProps extends MoveAnnotations {
	isCurrentMove: boolean;
	san: string;
	onMoveItemClick: () => void;
}

export const MoveItem = ({
	isCurrentMove,
	san,
	comment,
	shapes,
	onMoveItemClick,
}: MoveItemProps) => {
	const ref = useScrollIntoView(isCurrentMove);

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
		>
			{san}
			<Markers comment={comment} shapes={shapes} />
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
	onMoveItemClick,
	moveIndicator = null,
}: VariantMoveItemProps) => {
	const ref = useScrollIntoView(isCurrentMove);

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
			ref={ref as React.RefObject<HTMLDivElement>}
		>
			<span className="variant-move-indicator">{moveIndicator}</span>
			{san}
			<Markers comment={comment} shapes={shapes} />
		</div>
	);
};
