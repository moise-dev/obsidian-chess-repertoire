import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

interface StudyTitleProps {
	title: string | null;
	onTitleChange: (title: string | null) => void;
}

/**
 * The study title, editable in place. Until now it could only ever be whatever
 * the imported PGN's `opening` tag happened to say.
 */
export const StudyTitle = ({ title, onTitleChange }: StudyTitleProps) => {
	const [isEditing, setIsEditing] = useState(false);
	const [draft, setDraft] = useState(title ?? '');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setDraft(title ?? '');
	}, [title]);

	useEffect(() => {
		if (isEditing) inputRef.current?.select();
	}, [isEditing]);

	const commit = () => {
		const trimmed = draft.trim();

		setIsEditing(false);
		if (trimmed !== (title ?? '')) onTitleChange(trimmed || null);
	};

	if (!isEditing) {
		return (
			<button
				className={`cs-side-subtitle${title ? '' : ' is-empty'}`}
				title="Rename this study"
				onClick={() => setIsEditing(true)}
			>
				{title || 'Add a title'}
			</button>
		);
	}

	return (
		<input
			ref={inputRef}
			className="cs-side-subtitle-input"
			value={draft}
			placeholder="Study title"
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				// Stop these reaching the widget's own navigation/classification keys.
				e.stopPropagation();

				if (e.key === 'Enter') commit();
				if (e.key === 'Escape') {
					setDraft(title ?? '');
					setIsEditing(false);
				}
			}}
		/>
	);
};
