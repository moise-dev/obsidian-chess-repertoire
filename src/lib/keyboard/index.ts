/**
 * Getting the widget's shortcuts to work inside Live Preview.
 *
 * In Reading view a repertoire is an ordinary piece of DOM and its own keydown
 * handler is enough. In Live Preview it is a CodeMirror widget: it lives inside
 * the editor's `contenteditable`, CodeMirror keeps the selection and often the
 * focus, the Vim keymap wants the arrow keys, and the widget's DOM is rebuilt
 * whenever the cursor moves near the block.
 *
 * Three things follow, and all three are needed.
 *
 * 1. Which repertoire a key belongs to cannot live in React state. Live Preview
 *    remounts the widget, so anything component-local is wiped between the
 *    click that chose it and the key press that follows. The registry here is
 *    module-level and keyed by element.
 * 2. The key has to be caught before the editor acts on it, which is what the
 *    CodeMirror extension is for - and a window listener in the capture phase
 *    behind it, for anywhere the extension does not run.
 * 3. A repertoire is only owed the keys while the reader is actually in it, so
 *    clicking back into the note gives them up again.
 */

/** Returns true when the repertoire took the key and nothing else should see it. */
export type RepertoireKeyHandler = (event: KeyboardEvent) => boolean;

const repertoires = new Map<HTMLElement, RepertoireKeyHandler>();

/** The repertoire last interacted with, which is the one the keys belong to. */
let active: HTMLElement | null = null;

/**
 * Puts a repertoire on the register for as long as it is on screen. The returned
 * function takes it off again.
 */
export const registerRepertoireKeys = (
	el: HTMLElement,
	handler: RepertoireKeyHandler
): (() => void) => {
	repertoires.set(el, handler);

	return () => {
		repertoires.delete(el);

		if (active === el) active = null;
	};
};

/** Called when a repertoire is clicked into: from here the keys are its. */
export const setActiveRepertoire = (el: HTMLElement | null): void => {
	active = el;
};

/**
 * The repertoire a key press is for.
 *
 * The event's own target first, then whatever holds focus - and only then the
 * last one clicked into, since CodeMirror often takes the focus straight back
 * and the click is then the only record of where the reader is.
 */
const repertoireFor = (event: KeyboardEvent): HTMLElement | null => {
	const candidates = [
		(event.target as Element | null)?.closest?.('.chess-repertoire'),
		document.activeElement?.closest?.('.chess-repertoire'),
		active,
	];

	for (const candidate of candidates)
		if (candidate instanceof HTMLElement && repertoires.has(candidate))
			return candidate;

	return null;
};

/**
 * Offers the key to the repertoire it belongs to, and stops it dead if it is taken.
 *
 * Both stopping and preventing: the first keeps CodeMirror's own keydown
 * handling and the Vim keymap from seeing an arrow press, the second keeps the
 * browser from scrolling on one.
 */
export const handleRepertoireKey = (event: KeyboardEvent): boolean => {
	const repertoire = repertoireFor(event);

	if (!repertoire) return false;

	const handled = repertoires.get(repertoire)?.(event) ?? false;

	if (!handled) return false;

	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();

	return true;
};

/**
 * Gives up the keys when a click lands outside every repertoire, so typing in the
 * note is never intercepted by the repertoire read a moment ago.
 */
export const releaseOnOutsideClick = (event: Event): void => {
	const inside = (event.target as Element | null)?.closest?.(
		'.chess-repertoire'
	);

	if (!(inside instanceof HTMLElement) || !repertoires.has(inside))
		setActiveRepertoire(null);
};
