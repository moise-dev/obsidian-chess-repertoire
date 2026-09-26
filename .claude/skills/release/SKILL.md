---
name: release
description: Cut a release of the Chess Repertoire plugin - date the changelog, bump the version across the four files that must agree, tag from main, and publish the built release. Use when asked to release, cut a version, ship, bump the version, or tag a new version.
---

# Releasing Chess Repertoire

Obsidian installs the release whose git tag matches `manifest.json` exactly, so
a half-applied version ships something nobody can install. Four files carry the
number and must agree: `package.json`, `manifest.json`, `versions.json`,
`CHANGELOG.md`.

Take the version from the user if they gave one. Otherwise propose one from the
`## [Unreleased]` section and say why: only `### Fixed` is a patch, anything
under `### Added` or that a user would notice as new is a minor, anything that
breaks their stored files or workflow is a major. Confirm before bumping.

## 1. Check there is something to release

```bash
git log --oneline -5 && sed -n '1,40p' CHANGELOG.md
```

Every user-visible change in the release needs an entry under `## [Unreleased]`.
If the work landed without one, write it before going further: bold
user-visible sentence first, then what was wrong and why the fix is shaped the
way it is. Match the surrounding entries.

If there is no `[Unreleased]` section at all, there is nothing to release. Say
so rather than inventing one.

## 2. Bump, on the branch or on main

```bash
npm version <x.y.z> --no-git-tag-version   # package.json + package-lock.json
node version-bump.mjs                      # manifest.json + versions.json
```

`--no-git-tag-version` matters. Plain `npm version` tags wherever it runs, and a
tag on a branch builds a release from code that is not on main. The tag is cut
in step 5.

Then rename the changelog heading, with today's real date:

```
## [Unreleased]   ->   ## [x.y.z] - YYYY-MM-DD
```

Get the date from `date +%F`, never from memory.

## 3. Prove it is coherent

```bash
npm test && npm run lint && npm run build && npx prettier --check CHANGELOG.md
```

`tests/release.test.ts` checks all four files agree and that the changelog
section has content under it. It failing is the whole point of running it here,
where the fix is cheap. `npm run lint` must report 0 errors; the release
workflow runs it too.

## 4. Commit and merge

The version bump is its own commit, subject line just the number, matching
history (`git log --oneline` shows `1.4.0`, `1.5.0`, `1.5.1`). Body: what was
carried where, and anything unusual about this release.

If the work is on a branch, open or update the PR and merge it with `--rebase`
(history here is linear, no merge commits), then:

```bash
git checkout main && git pull --ff-only
```

Confirm `node -p "require('./manifest.json').version"` is the version being
released before tagging.

## 5. Tag from main

```bash
git tag <x.y.z> && git push origin <x.y.z>
```

Pushing the tag triggers `.github/workflows/release.yml`. It refuses a tag that
disagrees with the manifest, extracts the release notes from the matching
changelog section, runs lint, tests and build, and creates a **draft** release
with `main.js`, `manifest.json` and `styles.css` attached.

Watch it rather than assuming:

```bash
gh run list --limit 1 && gh run watch <id> --exit-status
```

If it fails, read the failing step. The two it is designed to catch are a tag
that disagrees with the manifest and a changelog with nothing under the
heading; both mean deleting the tag (`git push --delete origin <x.y.z>`), fixing
the cause on main, and tagging again.

## 6. Publish

The draft is deliberate: a person publishes it. Report the release URL and the
attached assets, then ask before running:

```bash
gh release edit <x.y.z> --draft=false
```

Publishing is what makes it installable and visible to everyone using the
plugin, so do not do it unasked. If the user has already said to publish as part
of the request, that is the authorisation - go ahead and say that it is live.

## Afterwards

Offer to deploy the released build to the user's vault so they are running what
they just shipped. The `deploy-to-vault` skill does that.
