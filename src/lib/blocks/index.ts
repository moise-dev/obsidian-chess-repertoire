/**
 * The bodies of every fenced code block in `content` written for `language`.
 *
 * A scan rather than a regex, so a fence inside a longer fence - a markdown
 * example holding a chessRepertoire block, say - is read as content and not as a
 * block of its own. A block left unterminated at the end of the note is not
 * returned: it is not a block yet.
 *
 * Its own module, free of Obsidian imports, so it can be tested without
 * dragging the whole API into the test bundle.
 */
export const findCodeBlocks = (content: string, language: string): string[] => {
	const blocks: string[] = [];

	let fence: string | null = null;
	let isWanted = false;
	let body: string[] = [];

	for (const line of content.split('\n')) {
		if (fence === null) {
			const opening = line.match(/^\s*(`{3,})\s*(\S*)/);

			if (!opening) continue;

			fence = opening[1];
			isWanted = opening[2] === language;
			body = [];

			continue;
		}

		// A closing fence carries no info string and is at least as long as the
		// one that opened the block.
		const closing = line.match(/^\s*(`{3,})\s*$/);

		if (closing && closing[1].length >= fence.length) {
			if (isWanted) blocks.push(body.join('\n'));

			fence = null;

			continue;
		}

		body.push(line);
	}

	return blocks;
};
