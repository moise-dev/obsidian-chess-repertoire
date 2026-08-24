import { Chess, Move } from 'chess.js';
import { Chessground as ChessgroundApi } from 'chessground';
import { Api } from 'chessground/api';
import { Config } from 'chessground/config';
import { DrawShape } from 'chessground/draw';
import * as React from 'react';
import { useEffect, useRef } from 'react';
import { BoardColor } from 'src/components/obsidian/SettingsTab';
import { playOtherSide, toColor, toDests } from 'src/lib/chess-logic';

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
	 * can never leak into the arrows saved with the study.
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

		return (
			<div className={`cs-board ${boardColor}-board`}>
				<div ref={ref} className="height-width-100" />
			</div>
		);
	}
);

ChessgroundWrapper.displayName = 'ChessgroundWrapper';
