import { JSONContent } from '@tiptap/react';
import * as React from 'react';
import { commentToPlainText, hasComment } from 'src/lib/comments';

/** Marker shown on moves that carry a note. */
const NoteMarker = () => <span className="cs-move-note" aria-hidden="true" />;

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

interface MoveItemProps {
	isCurrentMove: boolean;
	san: string;
	comment?: JSONContent | null;
	onMoveItemClick: () => void;
}

export const MoveItem = ({
	isCurrentMove,
	san,
	comment,
	onMoveItemClick,
}: MoveItemProps) => {
	const ref = useScrollIntoView(isCurrentMove);
	const hasNote = hasComment(comment);

	return (
		<p
			className={`move-item ${(isCurrentMove && 'active') || ''} ${
				(hasNote && 'has-note') || ''
			} vertical-align`}
			ref={ref as React.RefObject<HTMLParagraphElement>}
			title={hasNote ? commentToPlainText(comment) : undefined}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
		>
			{san}
			{hasNote && <NoteMarker />}
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
	onMoveItemClick,
	moveIndicator = null,
}: VariantMoveItemProps) => {
	const ref = useScrollIntoView(isCurrentMove);
	const hasNote = hasComment(comment);

	return (
		<div
			className={`variant-move-item ${(isCurrentMove && 'active') || ''} ${
				(hasNote && 'has-note') || ''
			}`}
			title={hasNote ? commentToPlainText(comment) : undefined}
			onClick={(e) => {
				e.stopPropagation();
				onMoveItemClick();
			}}
			ref={ref as React.RefObject<HTMLDivElement>}
		>
			<span className="variant-move-indicator">{moveIndicator}</span>
			{san}
			{hasNote && <NoteMarker />}
		</div>
	);
};
