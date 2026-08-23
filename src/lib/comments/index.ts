import { JSONContent } from '@tiptap/react';

/**
 * Comments are TipTap documents, and an untouched editor still serialises to a
 * single empty paragraph - so a non-null comment does not mean there is a note.
 */
export const hasComment = (comment: JSONContent | null | undefined): boolean =>
	Boolean(
		comment?.content?.some(
			(node) => node.content?.length || node.type === 'horizontalRule'
		)
	);

const nodeText = (node: JSONContent): string =>
	node.text ?? node.content?.map(nodeText).join('') ?? '';

/**
 * Flattens a comment to a single line, for tooltips.
 */
export const commentToPlainText = (
	comment: JSONContent | null | undefined,
	maxLength = 200
): string => {
	if (!comment?.content) return '';

	const blocks = comment.content
		.map((node) => nodeText(node).trim())
		.filter(Boolean);

	const text = blocks.join(' · ').replace(/\s+/g, ' ');

	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};
