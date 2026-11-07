export type BoardOrientation = 'white' | 'black';

/** The way round the board is played from a given side. */
export const orientationFor = (color: 'w' | 'b'): BoardOrientation =>
	color === 'b' ? 'black' : 'white';

/**
 * Which way round a repertoire's board starts.
 *
 * A `boardOrientation` written in the block wins, since someone put it there on
 * purpose. Otherwise the side the repertoire is written for: it is stored in
 * the repertoire's file, so it survives the widget being rebuilt, which happens
 * every time the note is left and opened again. Orientation itself is never
 * stored - a flip is a look from the other side, and saving it would make
 * reading a repertoire write to it, which a locked one or a phone must not do.
 * The plugin's default is what is left when neither has said.
 *
 * The block value is the raw YAML, so anything but the two words is ignored
 * rather than trusted.
 */
export const initialOrientation = ({
	blockOrientation,
	playerColor,
	defaultOrientation,
}: {
	blockOrientation: unknown;
	playerColor: 'w' | 'b' | undefined;
	defaultOrientation: BoardOrientation;
}): BoardOrientation => {
	if (blockOrientation === 'white' || blockOrientation === 'black')
		return blockOrientation;

	return playerColor ? orientationFor(playerColor) : defaultOrientation;
};
