# Working on Chess Repertoire

An Obsidian plugin: a chessboard in a note, backed by a repertoire file, with a
drill mode that asks the moves back. Desktop only. The README says what it does
for the person using it; this says how it is built and released.

## Commands

| Command          | What it does                                                                       |
| ---------------- | ---------------------------------------------------------------------------------- |
| `npm test`       | Bundles `tests/*.test.ts` and runs them on node's own test runner.                 |
| `npm run lint`   | ESLint. Should report 0 errors; there are some standing warnings.                  |
| `npm run build`  | `tsc -noEmit` then a production esbuild. Run it before claiming a change compiles. |
| `npm run dev`    | esbuild in watch mode, writing `main.js` here rather than into a vault.            |
| `npm run deploy` | Build, then copy into a vault. See below.                                          |

A pre-commit hook runs `pretty-quick --staged`, so anything staged is formatted
on the way in. Tabs, single quotes, and `proseWrap: preserve`, which is why the
changelog's hand-wrapped paragraphs survive a format.

## Seeing a change in Obsidian

`deploy.mjs` has no default vault path, on purpose: the repo is public and a
vault path belongs to whoever is running it. Point the variable at the plugin
folder inside the vault:

```bash
CHESS_REPERTOIRE_VAULT_PLUGIN_DIR=<vault>/.obsidian/plugins/chess-repertoire npm run deploy
```

Copying the files changes nothing that is already running. Obsidian has to be
told: toggle Chess Repertoire off and on under Community plugins, or run
"Reload app without saving" from the command palette.

## Where code goes

Logic lives in `src/lib/<name>/index.ts` as plain functions, with its tests in
`tests/<name>.test.ts`. React components wire those functions to the screen and
hold as little of their own as they can manage.

This is not tidiness for its own sake. The suite runs on node with no browser
and no layout engine, so anything that can only be exercised through a rendered
component cannot be tested at all. `src/lib/scroll` is the clearest example: it
is the arithmetic of keeping the current move in view, lifted out of the move
list so that "scrolls by as little as it takes" is a test rather than a claim.
When a component starts making decisions, the decision moves to `src/lib` and
the component keeps the wiring.

Obsidian's own API is kept to the edges - `src/main.tsx`, `src/components/obsidian`,
`src/lib/obsidian` - because tests stub it. `tests/stubs/obsidian.ts` is aliased
over the real module by the `test` script, and it only implements what the tests
have needed so far. Reaching for a new Obsidian API from inside `src/lib` means
adding to that stub, which is usually the signal that the code belongs further
out.

`src/components/react/ChessRepertoire.tsx` is the hub: it owns the chess.js
instance, the chessground board, the `ui-state` reducer and the save cycle, and
hands everything else down. It is long, and adding to it should be the second
choice.

## Conventions, stated once

**Comments say why, not what.** The code says what. A comment earns its place by
recording the thing that is not in the code: the bug that made this necessary,
the obvious alternative and why it fails, the constraint that makes a strange
line correct. `tests/release.test.ts:13` is a good example of the register.

**Changelog entries lead with the user-visible sentence, in bold**, and then
explain. Entries collect under `## [Unreleased]` until a release renames the
heading. `### Fixed` / `### Added` / `### Security`, following Keep a Changelog.

**Commit subjects are conventional** (`fix:`, `feat:`, `chore:`, `test:`,
`docs:`, `ci:`), and the body is prose: what was wrong, why the fix is shaped
the way it is, what was considered and rejected. Look at `git log` before
writing one.

**No em dashes or en dashes anywhere** - prose, comments, changelog, commit
messages. Plain hyphens.

**Prefer a test to a rule.** Where an invariant can be checked, check it:
`tests/release.test.ts` enforces the whole release metadata contract, so nothing
has to remember it. That is the preferred shape for any new convention.

## Releasing

Obsidian installs the release whose git tag matches `manifest.json` exactly, so
the version has to reach four files together: `package.json`, `manifest.json`,
`versions.json`, `CHANGELOG.md`. `npm version <x.y.z>` does the first three
(`version-bump.mjs` runs as npm's `version` lifecycle script); the changelog
heading is renamed by hand from `[Unreleased]` to `## [x.y.z] - YYYY-MM-DD`.

`tests/release.test.ts` checks all four agree and that the changelog section has
something under it, so `npm test` is the proof the release is coherent.

The tag is cut **from main after the work is merged**, never from a branch:
`npm version` tags wherever it is run, and a tag on a branch builds a release
from code that is not on main. When the version bump has been made on a branch,
tag by hand after merging:

```bash
git tag <x.y.z> && git push origin <x.y.z>
```

Pushing the tag triggers `.github/workflows/release.yml`, which refuses a tag
that disagrees with the manifest, takes the release notes from the matching
changelog section, runs lint, tests and build, and creates a **draft** release
with `main.js`, `manifest.json` and `styles.css`. The draft is deliberate: it is
published by a person, with `gh release edit <x.y.z> --draft=false`.

There is a `/release` skill that walks this.

## Versioning

Semver, and for a plugin that means: patch for a fix, minor for anything a user
would notice as new, major for anything that breaks their files or workflow.
`1.3.1` and `1.5.1` are the shape of a patch release - a `### Fixed` section and
nothing else.

## Things that have bitten

- `npm version` reads the version back from `package.json` rather than
  `npm_package_version`, which still holds the old number while the script runs.
  `version-bump.mjs:5` explains it.
- The repertoire's own data is the product. A change that rewrites stored JSON
  on load - a Tiptap extension that appends a node, an editor command that emits
  an update on load - will be saved over the user's notes by autosave. Both of
  those have happened. When touching the notes editor, ask what it writes when
  it opens a document it was only meant to display.
