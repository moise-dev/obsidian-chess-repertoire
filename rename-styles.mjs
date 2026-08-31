import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';

/**
 * Chessground's own rule for the piece being dragged.
 *
 * Its `!important` is there to beat an inline z-index, which chessground only
 * writes when `addPieceZIndex` is on - a 3D piece set. This plugin ships 2D
 * pieces and never turns it on, so nothing competes with the rule and the
 * `!important` does nothing here except trip the plugin review's CSS lint on a
 * line we did not write.
 *
 * Scoped to that one rule rather than run over the whole file: an `!important`
 * somebody adds on purpose later should stay where they put it.
 */
const stripVendorImportant = (css) =>
	css.replace(/(cg-board piece\.dragging\s*\{[^}]*?)\s*!important/g, '$1');

export const renameStyles = {
	name: 'rename-styles',
	setup(build) {
		build.onEnd(() => {
			const { outfile } = build.initialOptions;
			const outcss = outfile.replace(/\.js$/, '.css');
			const fixcss = outfile.replace(/main\.js$/, 'styles.css');
			if (existsSync(outcss)) {
				console.log('Renaming', outcss, 'to', fixcss);
				renameSync(outcss, fixcss);

				const css = stripVendorImportant(readFileSync(fixcss, 'utf8'));

				writeFileSync(fixcss, css);

				// Says so rather than failing: the count is the plugin review's
				// warning, and whoever added one is better placed than the build to
				// decide whether it was worth it.
				const left = css.match(/!important/g)?.length ?? 0;

				if (left) console.log(`${fixcss} still has ${left} !important.`);
			}
		});
	},
};
