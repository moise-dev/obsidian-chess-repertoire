import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { handleRepertoireKey } from './index';

/**
 * Catches a key inside the editor before the editor does.
 *
 * `Prec.highest` is what puts this ahead of the Vim keymap, which otherwise
 * takes the arrow keys for itself. The handler only claims a press that a repertoire
 * actually wants, so ordinary editing is untouched.
 */
export const chessRepertoireKeymap = () =>
	Prec.highest(
		EditorView.domEventHandlers({
			keydown: (event) => handleRepertoireKey(event, 'codemirror'),
		})
	);
