import { Color, PieceSymbol, Square } from 'chess.js';
import { Color as BoardOrientation } from 'chessground/types';
import * as React from 'react';
import { PROMOTION_PIECES } from 'src/lib/chess-logic';
import { Piece, ROLES } from '../MiniBoard';

export interface PromotionPickerProps {
	dest: Square;
	color: Color;
	orientation: BoardOrientation;
	onChoose: (piece: PieceSymbol) => void;
	onCancel: () => void;
}

const file = (square: Square) => square.charCodeAt(0) - 97;
const rank = (square: Square) => Number(square[1]) - 1;

/**
 * The four squares a promoting pawn could become, stacked over the
 * destination and running toward the middle of the board so they land on
 * empty squares rather than off the edge. `cs-board` is exactly the 8x8
 * square chessground occupies, so the offer is placed in percentages of it
 * rather than measured in pixels.
 */
export const PromotionPicker = ({
	dest,
	color,
	orientation,
	onChoose,
	onCancel,
}: PromotionPickerProps) => {
	const fileIndex = file(dest);
	const rankIndex = rank(dest);

	const left = (orientation === 'white' ? fileIndex : 7 - fileIndex) * 12.5;
	// The destination square is always the board's top or bottom row, since
	// that is the only place a pawn promotes.
	const atTop = (orientation === 'white') === (rankIndex === 7);

	return (
		<div
			className="cs-promotion-backdrop"
			onClick={onCancel}
			role="presentation"
		>
			<div
				className="cs-promotion-picker cg-wrap"
				style={{ left: `${left}%`, ...(atTop ? { top: 0 } : { bottom: 0 }) }}
				onClick={(event) => event.stopPropagation()}
			>
				{PROMOTION_PIECES.map((piece) => (
					<button
						key={piece}
						type="button"
						className="cs-promotion-choice"
						aria-label={ROLES[piece]}
						onClick={() => onChoose(piece)}
					>
						<Piece role={ROLES[piece]} color={color === 'w' ? 'white' : 'black'} />
					</button>
				))}
			</div>
		</div>
	);
};
