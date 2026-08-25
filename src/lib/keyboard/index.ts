/**
 * Getting the widget's shortcuts to work inside Live Preview.
 *
 * In Reading view a study is an ordinary piece of DOM and its own keydown
 * handler is enough. In Live Preview it is a CodeMirror widget: it lives inside
 * the editor's `contenteditable`, CodeMirror keeps the selection and often the
 * focus, the Vim keymap wants the arrow keys, and the widget's DOM is rebuilt
 * whenever the cursor moves near the block.
 *
 * Three things follow, and all three are needed.
 *
 * 1. Which study a key belongs to cannot live in React state. Live Preview
 *    remounts the widget, so anything component-local is wiped between the
 *    click that chose it and the key press that follows. The registry here is
 *    module-level and keyed by element.
 * 2. The key has to be caught before the editor acts on it, which is what the
 *    CodeMirror extension is for - and a window listener in the capture phase
 *    behind it, for anywhere the extension does not run.
 * 3. A study is only owed the keys while the reader is actually in it, so
 *    clicking back into the note gives them up again.
 */

/** Returns true when the study took the key and nothing else should see it. */
export type StudyKeyHandler = (event: KeyboardEvent) => boolean;

const studies = new Map<HTMLElement, StudyKeyHandler>();

/** The study last interacted with, which is the one the keys belong to. */
let active: HTMLElement | null = null;

/** `window.CHESS_STUDY_DEBUG_KEYS = true` narrates where a key press went. */
const isDebugging = () =>
	!!(window as unknown as Record<string, unknown>).CHESS_STUDY_DEBUG_KEYS;

const describe = (node: Element | null): string => {
	if (!node) return 'none';

	const className =
		typeof node.className === 'string' && node.className
			? `.${node.className.trim().split(/\s+/).join('.')}`
			: '';

	return `${node.tagName.toLowerCase()}${className}`;
};

export const debugKeys = (
	stage: string,
	event: KeyboardEvent,
	note = ''
): void => {
	if (!isDebugging()) return;

	console.log(
		`[chess-study keys] ${stage}`,
		{
			key: event.key,
			target: describe(event.target as Element),
			activeElement: describe(document.activeElement),
			activeStudy: describe(active),
			defaultPrevented: event.defaultPrevented,
		},
		note
	);
};

/**
 * Puts a study on the register for as long as it is on screen. The returned
 * function takes it off again.
 */
export const registerStudyKeys = (
	el: HTMLElement,
	handler: StudyKeyHandler
): (() => void) => {
	studies.set(el, handler);

	return () => {
		studies.delete(el);

		if (active === el) active = null;
	};
};

/** Called when a study is clicked into: from here the keys are its. */
export const setActiveStudy = (el: HTMLElement | null): void => {
	active = el;
};

/**
 * The study a key press is for.
 *
 * The event's own target first, then whatever holds focus - and only then the
 * last one clicked into, since CodeMirror often takes the focus straight back
 * and the click is then the only record of where the reader is.
 */
const studyFor = (event: KeyboardEvent): HTMLElement | null => {
	const candidates = [
		(event.target as Element | null)?.closest?.('.chess-study'),
		document.activeElement?.closest?.('.chess-study'),
		active,
	];

	for (const candidate of candidates)
		if (candidate instanceof HTMLElement && studies.has(candidate))
			return candidate;

	return null;
};

/**
 * Offers the key to the study it belongs to, and stops it dead if it is taken.
 *
 * Both stopping and preventing: the first keeps CodeMirror's own keydown
 * handling and the Vim keymap from seeing an arrow press, the second keeps the
 * browser from scrolling on one.
 */
export const handleStudyKey = (
	event: KeyboardEvent,
	stage: string
): boolean => {
	const study = studyFor(event);

	if (!study) {
		debugKeys(stage, event, 'no study owns this key');

		return false;
	}

	const handled = studies.get(study)?.(event) ?? false;

	debugKeys(stage, event, handled ? 'handled' : 'study declined it');

	if (!handled) return false;

	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();

	return true;
};

/**
 * Gives up the keys when a click lands outside every study, so typing in the
 * note is never intercepted by the study read a moment ago.
 */
export const releaseOnOutsideClick = (event: Event): void => {
	const inside = (event.target as Element | null)?.closest?.('.chess-study');

	if (!(inside instanceof HTMLElement) || !studies.has(inside))
		setActiveStudy(null);
};
