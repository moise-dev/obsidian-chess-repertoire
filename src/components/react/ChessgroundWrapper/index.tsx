import { Chess, Move, PieceSymbol, Square } from 'chess.js';
import { Chessground as ChessgroundApi } from 'chessground';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';
import { DrawShape } from 'chessground/draw';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { BoardColor } from 'src/components/obsidian/SettingsTab';
import {
	isPromotionMove,
	playOtherSide,
	toColor,
	toDests,
} from 'src/lib/chess-logic';
import { PromotionPicker } from './PromotionPicker';

export interface ChessgroundProps {
	api: Api | null;
	setApi: React.Dispatch<React.SetStateAction<Api>>;
	chess: Chess;
	addMoveToHistory: (move: Move) => void;
	syncShapes: (shapes: DrawShape[]) => void;
	isViewOnly: boolean;
	shapes: DrawShape[];
	/**
	 * Decorations owned by the plugin rather than the user. These go to
	 * setAutoShapes, a separate array that never fires drawable.onChange, so they
	 * can never leak into the arrows saved with the repertoire.
	 */
	autoShapes?: DrawShape[];
	config?: Config;
	boardColor?: BoardColor;
}

export const ChessgroundWrapper = React.memo(
	({
		api,
		setApi,
		chess,
		addMoveToHistory,
		syncShapes: setShapes,
		isViewOnly,
		shapes,
		autoShapes,
		boardColor = 'blue',
		config = {},
	}: ChessgroundProps) => {
		const ref = useRef<HTMLDivElement>(null);

		// A pawn drop that reaches the last rank waits here for a piece before
		// it becomes a move: chessground reports orig/dest only, and the choice
		// isn't chess.js's to make.
		const [pendingPromotion, setPendingPromotion] = useState<{
			orig: Square;
			dest: Square;
		} | null>(null);

		//Chessground Init
		useEffect(() => {
			if (!ref.current || api) return;

			setApi(
				ChessgroundApi(ref.current, {
					fen: chess.fen(),
					animation: { enabled: true, duration: 100 },
					check: chess.isCheck(),
					movable: {
						free: false,
						color: toColor(chess),
						dests: toDests(chess),
					},
					highlight: {
						check: true,
					},
					drawable: {
						// Chessground erases the drawn shapes on any left click and
						// reports that through onChange, which for a repertoire means
						// clicking a piece to move it wipes the arrows saved against
						// the move you are on - and autosave commits the loss. Off,
						// the erase is left to clicks on an empty square or an enemy
						// piece, and picking up your own piece keeps them.
						eraseOnClick: false,
						onChange: (shapes) => {
							setShapes(shapes);
						},
					},
					turnColor: toColor(chess),
					...config,
				})
			);
		}, [api, chess, config, setApi, setShapes]);

		// Orientation and coordinates, which the board does not derive itself.
		// Its own effect, or every render of the widget re-applied them.
		useEffect(() => {
			api?.set(config);
		}, [api, config]);

		//Sync Chess Logic
		useEffect(() => {
			api?.set({
				movable: {
					events: {
						//Hook up the Chessground UI changes to our App State
						after: (orig, dest, _metadata) => {
							if (isPromotionMove(chess, orig as Square, dest as Square)) {
								setPendingPromotion({ orig: orig as Square, dest: dest as Square });
								return;
							}

							const handler = playOtherSide(api, chess);

							addMoveToHistory(handler(orig, dest));
						},
					},
				},
			});
		}, [addMoveToHistory, api, chess]);

		//Sync View Only
		useEffect(() => {
			api?.set({ viewOnly: isViewOnly });
		}, [isViewOnly, api]);

		// Load Shapes
		useEffect(() => {
			if (shapes) {
				api?.setShapes([...shapes]);
			}
		}, [api, shapes]);

		// Plugin-owned decorations, kept apart from the user's own shapes.
		useEffect(() => {
			api?.setAutoShapes([...(autoShapes ?? [])]);
		}, [api, autoShapes]);

		const cancelPromotion = () => {
			if (!pendingPromotion || !api) return;

			// Nothing was ever played, only shown - chess.js's state didn't move,
			// so putting the board back is just re-reading it.
			api.set({
				fen: chess.fen(),
				turnColor: toColor(chess),
				movable: { color: toColor(chess), dests: toDests(chess) },
				check: chess.isCheck(),
			});
			setPendingPromotion(null);
		};

		const choosePromotion = (piece: PieceSymbol) => {
			if (!pendingPromotion || !api) return;

			const handler = playOtherSide(api, chess);

			addMoveToHistory(
				handler(pendingPromotion.orig, pendingPromotion.dest, piece)
			);
			setPendingPromotion(null);
		};

		return (
			<div className={`cs-board ${boardColor}-board`}>
				<div ref={ref} className="height-width-100" />

				{pendingPromotion && (
					<PromotionPicker
						dest={pendingPromotion.dest}
						color={chess.turn()}
						orientation={api?.state.orientation ?? 'white'}
						onChoose={choosePromotion}
						onCancel={cancelPromotion}
					/>
				)}
			</div>
		);
	}
);

ChessgroundWrapper.displayName = 'ChessgroundWrapper';
