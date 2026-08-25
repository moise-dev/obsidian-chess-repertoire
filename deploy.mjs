/**
 * Copy the built plugin into the Obsidian vault.
 *
 * Override the target with CHESS_STUDY_VAULT_PLUGIN_DIR when working against a
 * different vault.
 */
import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const target =
	process.env.CHESS_STUDY_VAULT_PLUGIN_DIR ??
	'/mnt/TheKnowledge/.obsidian/plugins/chess-repertoire';

if (!existsSync(target)) {
	console.error(`Target plugin folder does not exist: ${target}`);
	process.exit(1);
}

for (const file of ['main.js', 'styles.css', 'manifest.json']) {
	copyFileSync(file, join(target, file));
	console.log(`Copied ${file} -> ${join(target, file)}`);
}

console.log('\nReload the plugin in Obsidian to pick up the changes.');
