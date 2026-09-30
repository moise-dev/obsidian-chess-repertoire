import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

interface RepertoireTitleProps {
	title: string | null;
	onTitleChange: (title: string | null) => void;
	isLocked: boolean;
}

/** The repertoire title, editable in place unless the repertoire is locked. */
export const RepertoireTitle = ({
	title,
	onTitleChange,
	isLocked,
}: RepertoireTitleProps) => {
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

	// Not a disabled button: there is nothing to press, and an untitled locked
	// repertoire should say it has no title rather than invite one.
	if (isLocked) {
		return (
			<span
				className={`cs-side-subtitle${title ? '' : ' is-empty'}`}
				title="This repertoire is locked."
			>
				{title || 'Untitled'}
			</span>
		);
	}

	if (!isEditing) {
		return (
			<button
				className={`cs-side-subtitle${title ? '' : ' is-empty'}`}
				title="Rename this repertoire"
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
			placeholder="Repertoire title"
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
