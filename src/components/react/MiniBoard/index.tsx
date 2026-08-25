import * as React from 'react';
import { useMemo } from 'react';
import { BoardColor } from 'src/components/obsidian/SettingsTab';
import { fenToBoard } from 'src/lib/move-map';

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
 * pieces come back as empty boxes - and because a diagram of a study should not
 * show a different set of pieces from the study.
 */
const Piece = ({ role, color }: { role: string; color: string }) =>
	React.createElement('piece', { className: `${role} ${color}` });

export interface MiniBoardProps {
	fen: string;
	flipped: boolean;
	boardColor: BoardColor;
	/** Tooltip naming the position, where there is something to name it. */
	label?: string;
	/** Board edge in px. Left off, it fills whatever box it is put in. */
	size?: number;
}

/**
 * A position, drawn as a grid of squares with the real piece sprites dropped
 * into them.
 *
 * Not a live board: no moves, no drag, no chessground instance. A map can hold
 * a hundred of these and a hundred board instances is a different feature.
 */
export const MiniBoard = ({
	fen,
	flipped,
	boardColor,
	label,
	size,
}: MiniBoardProps) => {
	const ranks = useMemo(() => {
		const board = fenToBoard(fen);

		return flipped ? board.map((rank) => [...rank].reverse()).reverse() : board;
	}, [fen, flipped]);

	// `cg-wrap` on the outside is what lets chessground's sprite rules find the
	// pieces; the grid itself carries the board colours.
	return (
		<div
			className="cs-map-board-wrap cg-wrap"
			title={label}
			style={size ? { width: size, height: size } : undefined}
		>
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
