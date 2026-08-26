import Placeholder from '@tiptap/extension-placeholder';
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
				StarterKit,
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
			editor?.setEditable(isEditable);
		}, [editor, isEditable]);

		useEffect(() => {
			if (!editor) return;
			const { from, to } = editor.state.selection;
			if (currentComment) {
				editor.commands.setContent(currentComment, false, {
					preserveWhitespace: true,
				});
			} else {
				editor.commands.clearContent();
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
