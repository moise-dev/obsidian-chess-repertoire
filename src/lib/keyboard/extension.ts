import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { handleStudyKey } from './index';

/**
 * Catches a key inside the editor before the editor does.
 *
 * `Prec.highest` is what puts this ahead of the Vim keymap, which otherwise
 * takes the arrow keys for itself. The handler only claims a press that a study
 * actually wants, so ordinary editing is untouched.
 */
export const chessStudyKeymap = () =>
	Prec.highest(
		EditorView.domEventHandlers({
			keydown: (event) => handleStudyKey(event, 'codemirror'),
		})
	);
