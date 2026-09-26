import { Placeholder } from '@tiptap/extensions';
import { EditorContent, JSONContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ChevronDown, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { MoveClassification } from 'src/lib/classification';
import { hasComment } from 'src/lib/comments';
import { ClassificationPicker } from '../ClassificationPicker';

interface CommentSectionProps {
	currentComment: JSONContent | null;
	setComments: (comment: JSONContent) => void;
	/** Which move the note belongs to, e.g. `4... h6`. */
	moveLabel: string | null;
	defaultOpen: boolean;
	classification: MoveClassification | null;
	onClassify: (classification: MoveClassification | null) => void;
}

export const CommentSection = React.memo(
	({
		currentComment,
		setComments,
		moveLabel,
		defaultOpen,
		classification,
		onClassify,
	}: CommentSectionProps) => {
		const [isOpen, setIsOpen] = useState(defaultOpen);

		// The root position has no move to hang a note on.
		const isEditable = Boolean(moveLabel);

		const editor = useEditor({
			extensions: [
				// Tiptap 3's StarterKit brings three extensions v2's did not, and a
				// note is a stored document rather than a view, so each of them
				// would change what is written to disk. Links and underlines are
				// marks nothing here writes or styles yet; the trailing node adds an
				// empty paragraph to every document it opens, which the editor then
				// reports as an edit and autosave writes back over the note.
				StarterKit.configure({
					link: false,
					underline: false,
					trailingNode: false,
				}),
				Placeholder.configure({
					placeholder: ({ editor: instance }) =>
						instance.isEditable
							? 'Add a note for this move…'
							: 'Select a move to add a note to it.',
					// The prompt is the panel's only content when there is no note,
					// so it has to be there before the cursor is, and when the panel
					// is read-only because no move is selected.
					showOnlyCurrent: false,
					showOnlyWhenEditable: false,
				}),
			],
			onUpdate: (state) => {
				const comment = state.editor.getJSON();
				if (comment) setComments(comment);
			},
		});

		useEffect(() => {
			// Told not to announce it. Whether a note can be edited is not a change
			// to the note, but `setEditable` reports one anyway unless asked not
			// to - and this runs before the note has been loaded in, so what it
			// announced was an empty editor. That answer was written back over a
			// real note every time this panel was mounted on a move that had one,
			// which is what happens on the way out of a drill.
			editor?.setEditable(isEditable, false);
		}, [editor, isEditable]);

		useEffect(() => {
			if (!editor) return;
			const { from, to } = editor.state.selection;
			if (currentComment) {
				editor.commands.setContent(currentComment, {
					// Loading a note into the editor is not an edit of it. Left to
					// emit, the load is reported as a change and written straight
					// back, which is how a note was lost on the way out of a drill.
					emitUpdate: false,
					parseOptions: { preserveWhitespace: true },
				});
			} else {
				// Same again, and this one changed under us: `clearContent` emitted
				// nothing by default in Tiptap 2 and emits by default in 3, so
				// landing on a move with no note would report an empty document as
				// that move's new note.
				editor.commands.clearContent(false);
			}
			editor.commands.setTextSelection({ from, to });
		}, [currentComment, editor]);

		const hasNote = hasComment(currentComment);

		return (
			<div className={`cs-notes ${isOpen ? 'is-open' : 'is-collapsed'}`}>
				<button
					className="cs-notes-header"
					onClick={() => setIsOpen((open) => !open)}
					aria-expanded={isOpen}
					title={isOpen ? 'Hide notes' : 'Show notes'}
				>
					{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
					<span className="cs-notes-title">Notes</span>
					{moveLabel && <span className="cs-notes-chip">{moveLabel}</span>}
					{hasNote && !isOpen && <span className="cs-notes-dot" />}
				</button>
				{isOpen && (
					<>
						<ClassificationPicker
							classification={classification}
							onClassify={onClassify}
							disabled={!isEditable}
						/>
						<div className={`cs-notes-body${isEditable ? '' : ' is-disabled'}`}>
							<EditorContent editor={editor} />
						</div>
					</>
				)}
			</div>
		);
	}
);

CommentSection.displayName = 'CommentSection';
