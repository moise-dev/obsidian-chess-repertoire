import { readFileSync } from 'fs';

/*
 * Stockfish.js 10 bundles a setImmediate polyfill whose last-but-one fallback
 * is the old Internet Explorer trick of creating a <script> element and
 * waiting for its readystatechange. Obsidian's plugin review flags any code
 * that creates script elements as an error, and fails the release over it.
 *
 * The branch can never run here. The loader runs in a worker, which has no
 * document, and the polyfill takes MessageChannel, the fallback before it,
 * which every worker has. So both the branch and the function it calls are
 * cut out of the loader's text as it is bundled.
 *
 * Exact strings rather than a pattern: if a later Stockfish.js changes this
 * code, the build stops and someone looks, rather than shipping a loader
 * that was patched by a guess.
 */
export const REMOVALS = [
	'else if(doc&&"onreadystatechange"in doc.createElement("script")){installReadyStateChangeImplementation()}',
	'function installReadyStateChangeImplementation(){var html=doc.documentElement;setImmediate=function(){var handle=addFromSetImmediateArguments(arguments);var script=doc.createElement("script");script.onreadystatechange=function(){runIfPresent(handle);script.onreadystatechange=null;html.removeChild(script);script=null};html.appendChild(script);return handle}}',
];

/**
 * The loader's text with the script-element fallback removed.
 *
 * @param {string} source
 * @returns {string}
 */
export const patchStockfishLoader = (source) =>
	REMOVALS.reduce((text, removal) => {
		const at = text.indexOf(removal);

		if (at === -1 || text.indexOf(removal, at + 1) !== -1)
			throw new Error(
				'stockfish-patch: the loader no longer matches the code this patch removes; see stockfish-patch.mjs'
			);

		return text.slice(0, at) + text.slice(at + removal.length);
	}, source);

/** Applies the patch where esbuild loads the loader as text. */
export const stockfishPatch = {
	name: 'stockfish-patch',
	setup(build) {
		build.onLoad({ filter: /stockfish[\\/]src[\\/]stockfish\.js$/ }, (args) => ({
			contents: patchStockfishLoader(readFileSync(args.path, 'utf8')),
			loader: 'text',
		}));
	},
};
