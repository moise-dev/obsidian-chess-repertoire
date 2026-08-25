/**
 * Carries the version `npm version` just wrote into the two files Obsidian
 * reads: the manifest it installs from, and the table saying which app version
 * each release needs.
 *
 * The version is read back from package.json rather than from
 * `npm_package_version`, which npm fills in when the process starts - before the
 * bump - and so still holds the old number by the time this runs. Taking it from
 * there wrote the old version back over the manifest, which looked like success
 * because the file was already at that number, and left a tag pointing at a
 * manifest that disagreed with it. The release workflow refuses to build that,
 * which is the only reason it was ever noticed.
 */
import { readFileSync, writeFileSync } from 'fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const targetVersion = readJson('package.json').version;

if (!targetVersion) {
	throw new Error('package.json has no version to carry over');
}

const manifest = readJson('manifest.json');
const { minAppVersion } = manifest;

manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);

const versions = readJson('versions.json');

versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);

console.log(`Set manifest.json and versions.json to ${targetVersion}.`);
