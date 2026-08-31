# Changelog

Notable changes to Chess Repertoire, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The two commands have shorter ids**: `insert-editor` and
  `merge-repertoires`, in place of ids that repeated the plugin's own name.
  Obsidian namespaces them already, so the old ones read as
  `chess-repertoire:insert-chess-repertoire` in anything that shows an id, and
  the plugin review asks for them not to. Their names and what they do are
  unchanged, but a hotkey set against an old id has to be set again. This is
  the last release that can do it: after the plugin is in the store, renaming
  an id would take everyone's hotkey with it.

- The repertoire title's hover underline is drawn as a dotted border rather
  than a `text-decoration`, which the review's CSS lint counts as only
  partially supported by the Obsidian version it checks against. It sits a
  pixel lower than it did and is otherwise the same.

- The README drops the three `<!-- omit in toc -->` directives, which the
  review reads as template text left unfilled. The table of contents itself is
  written out in the file and is unchanged; regenerating it would now list the
  three headings they were hiding.

## [1.5.0] - 2026-08-31

### Added

- **A way to delete the repertoire files nothing refers to.** A repertoire's
  file is written the moment the board is made, before its code block reaches
  the note, and nothing ever took it away again: a board made and thought
  better of, a note deleted, or a merge kept for its result each left a json
  behind under a name that means nothing to read. **Find unused files**, in the
  settings beside the folders it works on, reads your notes, counts an id
  mentioned anywhere - a block, a template, a canvas card, a line of prose - as
  still in use, and asks before it takes anything, with every file it would
  delete listed by name behind a disclosure. What it takes goes to the trash,
  and a file in the folder the plugin did not write is left alone.

- **A notes folder setting**, for how much of the vault that search reads.
  Empty, the default, is the whole vault: the only answer that cannot be wrong.
  A vault that keeps its chess notes in one place can name the folder and have
  the search read that alone. What it costs is that a note outside the folder
  is not seen, so the repertoire it uses looks unused - which is why the
  confirmation names the folder that was searched, and why a folder holding no
  notes at all stops the search rather than offering up every repertoire in the
  vault.

## [1.4.0] - 2026-08-30

### Fixed

- **Stepping through a long line no longer scrolls the note away from the
  board.** The move list keeps the current move in view, and the one line that
  did it asked the browser to make the move visible - which scrolls everything
  that can scroll, up to and including the note the widget sits in. On a
  repertoire long enough to need scrolling, pressing an arrow key carried the
  board off the top of the screen. The list now scrolls itself and nothing else.

- **A note is no longer wiped by leaving a drill.** The notes panel is put away
  for the length of a session and built again afterwards, and building it
  announced the note it was holding before it had loaded one - so an empty
  editor was saved over whatever the move actually said, and autosave committed
  it moments later. It took a move that had a note and a session that ended on
  it, which is why it came and went.

### Changed

- **The drill reaches the deep parts of a repertoire.** Which branch a session
  takes was weighted only by how often the moves already drilled under it were
  missed - a rate, which says the same about a branch holding three hundred
  moves never asked for as about one holding none. Measured over a thousand
  simulated sessions, picking a branch that way came out no better than tossing
  a coin, and a move several variations deep went undrilled almost indefinitely.

  A branch's share of the moves still never asked for now counts towards
  choosing it, alongside the miss rate. On a repertoire of 130 of your own
  moves that takes the share never drilled after a thousand sessions from 14%
  to 5%, and spreads the work more evenly rather than less. The term falls away
  to nothing at a position where every line has been drilled at least once, so
  a repertoire you have covered behaves exactly as before.

- The two bugs above were both in the seam between this plugin and a library it
  uses, where nothing the type checker or the existing tests could see. The
  suite now renders components against a real document for the handful of cases
  that need one - the board's arrows and the notes panel each have their own -
  and it no longer forces its own exit, which had been letting runs finish early
  and report a pass over tests that never ran.

## [1.3.1] - 2026-08-30

### Fixed

- **Every arrow drawn on a position is kept, and lets go of the pointer.** Only
  the first survived: the second stayed stuck to the mouse instead of being
  drawn, and neither it nor any after it was saved. The board hands over the
  arrows it holds by reference and goes on writing to that same list, which was
  then frozen as part of the move - so the next arrow failed to be added, part
  way through the step that releases it.

- **A position holding more than one of your own moves no longer marks every one
  but the first as a mistake.** A drill asked for the continuation of the line it
  was in and refused the rest, so a second prepared reply of your own colour -
  two White third moves, say - was scored against you for being the move you
  wrote down.

  Your own moves are now picked the way the opponent's replies always were:
  branches you have never drilled first, then the ones you keep missing. Since
  nothing on the board can show which branch the drill took, the trainer bar says
  so - _3 moves prepared here (Nf3, Bc4, d4) - this line plays Bc4_.

  A move named that way is given rather than asked for, so it is left out of your
  drill history whether you find it or not, and playing one of the other prepared
  moves rewinds the board without counting as a mistake. What is being drilled
  there is the line underneath it, which is unchanged.

### Changed

- **A line whose next mainline move is excluded now carries on into its
  variations** instead of ending the drill. Excluding a move takes that move and
  what follows it out of rehearsal; it was also taking the alternatives beside it,
  which are a different branch.

## [1.3.0] - 2026-08-27

Repertoires move out of the plugin's own folder and into the vault, where the
rest of your notes are.

### Added

- **A setting for where repertoires are kept.** Settings → Community plugins →
  Chess Repertoire → Repertoire folder, a folder picker over the vault. Leave it
  empty for "Chess Repertoires" in the root. Changing it moves the files already
  written into the new folder, so it can be reorganised later without stranding
  anything; a name already taken in the destination is left alone rather than
  overwritten, and anything that could not be moved stays readable where it was.

### Changed

- **Repertoires are stored in the vault rather than in
  `.obsidian/plugins/chess-repertoire/storage`.** That folder is deleted whole
  when the plugin is uninstalled, and Obsidian Sync, version history and file
  recovery all pass over it - so uninstalling to reinstall, which is the ordinary
  way to fix a plugin, took every repertoire with it and left nothing to restore
  from.

  Existing repertoires are copied into the new folder the first time 1.3.0 loads,
  and the old folder is then renamed to `storage_bak` rather than deleted. The
  copy never overwrites, and the rename only happens once every file has arrived;
  a run that could not read something copies nothing over it, leaves the
  originals alone and tries again next load.

  Your notes need no changes. They reference repertoires by id, and the id is
  unchanged.

  **`storage_bak` is not a backup you can keep.** It is still inside the plugin
  folder, so it goes the same way on uninstall. Check your repertoires open, copy
  anything else out of it, and delete it.

  Repertoires are `.json`, which Obsidian Sync counts as an unsupported
  extension: moving them into the vault only syncs them if **Settings → Sync →
  All other file types** is on.

## [1.2.0] - 2026-08-26

Housekeeping, from the Obsidian plugin review. Nothing here changes what the
plugin does; the one user-visible line is the minimum app version.

### Changed

- **Obsidian 1.13 is now the minimum.** The settings tab is declared through
  `getSettingDefinitions()` rather than drawn by hand, so Obsidian renders it and
  its settings search can find the settings by name. Anyone on an older Obsidian
  keeps being offered 1.1.0, which is unaffected.

- The merge command drops "chess" from its name, since Obsidian already shows the
  plugin's name beside it. Command ids are unchanged, so existing hotkeys still
  work.

- The build declares `@codemirror/state` and `@codemirror/view` instead of
  borrowing them, replaces `builtin-modules` with node's own `module.builtinModules`,
  and moves from ESLint 8 to 10 with type-aware rules that now run in CI.

### Fixed

- `tsconfig`'s `lib` still named ES5/ES6/ES7, so `flatMap`, `Object.entries` and
  `Object.fromEntries` only type-checked by way of a lib reference `@types/node`
  happens to pull in. Anything built without that saw them as `any`, and the
  checking that should have covered every move, every drill record and every
  loaded repertoire was not happening.

- Promises that nothing awaited: the autosave timer, the board-size write, the
  map's drill-stats load, and the drill's colour prompt. A failure in any of them
  was an unhandled rejection nobody would ever see.

- A repertoire loaded from disk is now completed on the way in - version, header
  and root variants filled where an older file lacks them - rather than being
  handed on as whatever the file happened to hold.

- Every reported dependency advisory. `npm audit` is clean.

## [1.1.0] - 2026-08-25

### Added

- **Variations on a repertoire's first move.** Every variation hangs off the move
  _before_ the alternatives it holds, and the first move has none - so an
  alternative to it had nowhere to live. Playing a second first move was refused
  with a notice, the PGN importer dropped one, and a merge counted it as lost.
  The tree now keeps those alternatives itself, and they behave like any other
  variation: they import and export, drill, appear on the map, promote to the
  mainline, reorder and delete.

  This is invisible in an ordinary opening repertoire, where the first move is a
  fixed choice. It matters in one opened from a mid-game position, where the
  first move is a real decision and recording the candidates is the whole reason
  for importing the position.

- **Merging repertoires that continue from one another.** A note often holds an
  opening in instalments: a base line, then a repertoire opening from the
  position it ends in, then another from where that one stops. A merge joins each
  one at whatever move reaches the position it opens from, rather than only at a
  shared starting position. Positions are matched without their clocks, so a line
  arriving by a different move order still joins, and joining repeats until
  nothing more attaches, so the instalments may be listed in any order.

- **Drawn positions marked with a ½**, in the move list, on the board and on map
  cards. Stalemate, insufficient material, the fifty-move rule and repetition are
  all read from the board rather than set by hand, so there is nothing to
  remember and nothing to go stale. The mark sits beside a classification rather
  than replacing it: a move can be a blunder and still be the one that draws.

### Fixed

- **PGN export silently dropped the variations on a line's last move**, and with
  them everything underneath. Those are alternatives to a move that is not there,
  which makes them what follows the line - so the line now carries on into the
  first of them, and the rest become alternatives to its opening move. Reading
  that back gives the same tree.

- **Deleting a mainline** that had alternatives beside it left them with nothing
  to be alternatives to, and no first move for the list to draw them under. The
  oldest alternative now takes the vacant mainline.

### Changed

- **A merged continuation carries the mainline on** rather than arriving as a
  variation. Where the line it joins already goes on, a new reply really is an
  alternative to what follows and still hangs off the move before it; where the
  line stops, the first thing grafted on continues it. A note holding an opening
  in instalments now merges into one line rather than a line that ends and a
  variation that resumes it.

- **Map cards show the position their own moves reach**, rather than the position
  their first move reached. A card that forks now shows the position its children
  branch from, and a card that ends a line shows how it ends - the mate, the drawn
  position, the endgame. Previously a fork's card sat one position behind the fork
  it was illustrating, and the branches hanging off it differed from it and from
  one another by a single move, so they all looked alike.

- **A repertoire that records more than one first move** draws the starting
  position as its own card on the map, since that fork has no move to hang off
  either. One with a single first move draws exactly as before.

- Repertoire files move to storage version `0.0.7`, which adds the first move's
  alternatives. Older files are read unchanged and gain an empty list on load, so
  nothing needs converting.

## [1.0.0] - 2026-08-25

Initial release under the name Chess Repertoire, forked from
[chrislicodes/obsidian-chess-study](https://github.com/chrislicodes/obsidian-chess-study).

[1.5.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.5.0
[1.4.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.4.0
[1.3.1]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.3.1
[1.3.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.3.0
[1.2.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.2.0
[1.1.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.1.0
[1.0.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.0.0
