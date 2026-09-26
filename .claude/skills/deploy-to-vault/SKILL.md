---
name: deploy-to-vault
description: Build the plugin and install it into an Obsidian vault so a change can be seen in the real app. Use when asked to run, start, deploy, install, or try the plugin, to see a change working in Obsidian, or to test something by hand in a vault.
---

# Running this plugin in Obsidian

There is nothing to launch. An Obsidian plugin runs inside Obsidian, so
"running it" means building it, copying three files into a vault, and getting
the running app to reload them.

## 1. Find the vault

`deploy.mjs` deliberately has no default path: the repo is public and a vault
path belongs to whoever is running it. It reads
`CHESS_REPERTOIRE_VAULT_PLUGIN_DIR`, which is usually not exported in the
shell.

Resolve it in this order:

1. `echo "$CHESS_REPERTOIRE_VAULT_PLUGIN_DIR"` - if it is set, use it.
2. `cat ~/.config/obsidian/obsidian.json` - lists every vault Obsidian knows,
   by path. The plugin folder is `<vault>/.obsidian/plugins/chess-repertoire`.
3. Ask the user, if neither answers or there are several vaults and no way to
   tell which they mean.

Check the folder exists before deploying; `deploy.mjs` refuses to create it,
since a typo would otherwise leave files in a folder Obsidian never reads.

## 2. Build and copy

```bash
CHESS_REPERTOIRE_VAULT_PLUGIN_DIR=<that path> npm run deploy
```

That is `npm run build` (a `tsc -noEmit` type check, then a production esbuild)
followed by `deploy.mjs`, which copies `main.js`, `styles.css` and
`manifest.json`. A type error fails the build and nothing is copied.

If the user will be deploying repeatedly, mention that exporting the variable in
their shell profile saves retyping it.

## 3. Tell them to reload

Copying the files changes nothing that is already running, and this is the step
people forget. Obsidian has to be told, by one of:

- toggling Chess Repertoire off and on under Settings, Community plugins
- "Reload app without saving" from the command palette

Say which change to look for and where: the board is wherever a
` ```chessRepertoire ` block is in a note, drills start from the board's own
controls, and settings are under Community plugins.

Say as well that the vault is now running a build rather than a release. The
plugin is in the community store, which installs the same three files into the
same folder, so a deploy replaces the released copy and a store update replaces
the deploy. Getting back to the release means updating from the store, or
deploying from `main` at the tag.

## What this cannot do

You cannot drive the Obsidian UI, so you cannot confirm a change works by
looking at it. Deploy, say plainly what still needs checking by hand, and let
the user look. Do not report a visual change as verified.

For anything that can be checked without the app, `npm test` is the faster
answer and the logic usually lives in `src/lib` precisely so that it can be.
