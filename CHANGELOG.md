# Changelog

Notable changes to Chess Repertoire, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

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

[1.1.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.1.0
[1.0.0]: https://github.com/moise-dev/obsidian-chess-repertoire/releases/tag/1.0.0
