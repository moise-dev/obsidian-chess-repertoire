import * as React from 'react';
import { useMemo } from 'react';
import { BoardColor } from 'src/components/obsidian/SettingsTab';
import { fenToBoard } from 'src/lib/move-map';

const FILES = 'abcdefgh';

/** FEN letter to the role name chessground keys its sprites by. */
export const ROLES: Record<string, string> = {
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
 * pieces come back as empty boxes - and because a diagram of a repertoire should not
 * show a different set of pieces from the repertoire.
 */
export const Piece = ({ role, color }: { role: string; color: string }) =>
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
	// Flattened to sixty-four squares, each carrying its own name. Naming them
	// here rather than in the markup is what lets the grid below key a cell by
	// the square it is instead of by where it sits in an array.
	const squares = useMemo(() => {
		const board = fenToBoard(fen);
		const rows = flipped
			? board.map((rank) => [...rank].reverse()).reverse()
			: board;

		return rows.flatMap((rank, rankIndex) =>
			rank.map((piece, fileIndex) => ({
				name: flipped
					? `${FILES[7 - fileIndex]}${rankIndex + 1}`
					: `${FILES[fileIndex]}${8 - rankIndex}`,
				piece,
				isDark: (rankIndex + fileIndex) % 2 === 1,
			}))
		);
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
				{squares.map(({ name, piece, isDark }) => (
					<div
						key={name}
						className={`cs-map-square ${isDark ? 'is-dark' : 'is-light'}`}
					>
						{piece && (
							<Piece
								role={ROLES[piece.toLowerCase()]}
								color={piece === piece.toUpperCase() ? 'white' : 'black'}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	);
};
