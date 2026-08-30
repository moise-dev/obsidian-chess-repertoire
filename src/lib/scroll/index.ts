/** The top and bottom of something, in the same coordinates as everything else. */
export interface VerticalBounds {
	top: number;
	bottom: number;
}

/**
 * How far a scrolling box has to move to bring one of its children into view,
 * and zero where the child is already visible. Negative scrolls up.
 *
 * This is what `scrollIntoView` would work out for itself, and the reason not
 * to let it: it scrolls *every* scrollable ancestor the element has, and in a
 * note the outermost of those is Obsidian's own view. Stepping through a long
 * line with the arrow keys therefore scrolled the whole note down to follow the
 * move list, carrying the board the reader was watching off the screen.
 * `block: 'nearest'` limits how far each ancestor scrolls, not which of them do.
 *
 * Bounds rather than elements so the arithmetic can be checked without a
 * layout engine to produce them.
 */
export const scrollOffsetToShow = (
	child: VerticalBounds,
	box: VerticalBounds
): number => {
	const above = child.top - box.top;
	const below = child.bottom - box.bottom;

	// Off the top wins: a move taller than the box should show its start.
	if (above < 0) return above;

	return below > 0 ? Math.min(below, above) : 0;
};
