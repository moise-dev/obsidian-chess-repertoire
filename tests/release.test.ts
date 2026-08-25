import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Paths are relative to the repo root, which is where `npm test` runs from.
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Obsidian installs the release whose tag matches `manifest.json` exactly, so a
 * version that only got half way through the files ships something nobody can
 * install. The release workflow refuses to build a tag that disagrees with the
 * manifest; these catch the same mistake at the commit that makes it, which is
 * where it is still cheap to fix.
 *
 * They exist because `npm version` once bumped package.json and left the
 * manifest behind, and nothing said so.
 */
describe('release metadata', () => {
	const pkg = read('package.json');
	const manifest = read('manifest.json');
	const versions = read('versions.json');

	it('gives package.json and manifest.json the same version', () => {
		assert.equal(
			manifest.version,
			pkg.version,
			'run `node version-bump.mjs` after bumping package.json'
		);
	});

	it('records this version in versions.json', () => {
		assert.equal(
			versions[manifest.version],
			manifest.minAppVersion,
			`versions.json is missing an entry for ${manifest.version}`
		);
	});

	it('keeps a changelog entry for this version', () => {
		const changelog = readFileSync('CHANGELOG.md', 'utf8');

		assert.ok(
			changelog.includes(`## [${manifest.version}]`),
			`CHANGELOG.md has nothing for ${manifest.version}`
		);
	});
});
