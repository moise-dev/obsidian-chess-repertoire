import { BISHOP, Chess, KNIGHT, PieceSymbol, QUEEN, ROOK, SQUARES, Square } from 'chess.js';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';

/** Offered in this order, queen first as the common case. */
export const PROMOTION_PIECES: PieceSymbol[] = [QUEEN, ROOK, BISHOP, KNIGHT];

export function toColor(chess: Chess) {
	return chess.turn() === 'w' ? 'white' : 'black';
}

/** Whether playing orig-dest promotes a pawn, and so needs a piece choice. */
export function isPromotionMove(chess: Chess, orig: Square, dest: Square) {
	return chess
		.moves({ square: orig, verbose: true })
		.some((m) => m.to === dest && m.promotion);
}

export function toDests(chess: Chess): Map<Square, Square[]> {
	const dests = new Map();
	SQUARES.forEach((s) => {
		const ms = chess.moves({ square: s, verbose: true });
		if (ms.length)
			dests.set(
				s,
				ms.map((m) => m.to)
			);
	});
	return dests;
}

export function playOtherSide(cg: Api, chess: Chess) {
	return (orig: string, dest: string, promotion: PieceSymbol = QUEEN) => {
		const move = chess.move({ from: orig, to: dest, promotion });

		const commonTurnProperties: Partial<Config> = {
			turnColor: toColor(chess),
			movable: {
				color: toColor(chess),
				dests: toDests(chess),
			},
			check: chess.isCheck(),
		};

		if (move.flags === 'e' || move.promotion) {
			//Handle En Passant && the piece a promotion actually landed on
			cg.set({
				fen: chess.fen(),
				...commonTurnProperties,
			});
		} else {
			cg.set(commonTurnProperties);
		}

		return move;
	};
}
