// The `obsidian` package ships types and nothing else, so anything importing a
// value from it cannot be bundled for `node --test`. This stands in for the
// handful of helpers the tested modules actually call; everything else in the
// API is reached through interfaces the tests fake themselves.

/**
 * Obsidian's own `normalizePath`: forward slashes, no repeats, no leading or
 * trailing slash, non-breaking spaces folded to ordinary ones, NFC.
 */
export const normalizePath = (path: string): string =>
	path
		.replace(/([\\/])+/g, '/')
		.replace(/(^\/+|\/+$)/g, '')
		.replace(/\u00A0|\u202F/g, ' ')
		.normalize('NFC') || '/';
