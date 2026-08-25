<!-- omit in toc -->
# Chess Repertoire

A chess repertoire helper, PGN viewer/editor and opening trainer for [Obsidian](https://obsidian.md/).

Chess Repertoire is a fork of [Obsidian Chess Study](https://community.obsidian.md/plugins/chess-study) by [@chrislicodes](https://github.com/chrislicodes).

![Chess Repertoire in use](imgs/general-view.png)

<!-- omit in toc -->
## Table of contents

- [Trainer](#trainer)
- [The map](#the-map)
- [Export](#export)
- [Minor features](#minor-features)
- [Installation](#installation)
- [Usage](#usage)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Known limitations](#known-limitations)
- [Credits](#credits)
- [License](#license)

## Trainer

The graduation-cap button starts a drill. Pick a colour, and the board rewinds to the repertoire's starting position: you play your side, the repertoire plays the other. A move the repertoire doesn't know is refused and drawn as a red arrow.

Your own moves must follow the line you wrote down. Your opponent's replies are drawn from everything the repertoire records for that position, weighted toward lines you've gotten wrong before and lines you've never drilled. So if you have any variations, the opponent might play any variations or the mainline.

A line you'd rather keep than rehearse can be excluded from drills without deleting it, from any move's right-click menu.

![Training a line](imgs/repertoire-mode-hint.png)

Stuck? Hints escalate one press at a time: your note on the move, then the piece to move, then the arrow to play. Nothing a hint shows, and nothing a session does, ever touches your repertoire - it plays out on a side history that only tracks how you're doing.

You can do as many arrows as you like during a repertoire, they will not be saved in the original board.

When the line runs out, you get a report: moves played, mistakes made, and where each mistake was.

![Session report](imgs/repertoire-mode-report.png)

## The map

The network button opens the repertoire as a diagram - a trunk, and a card at every point your opponent gets to choose. It's the shape of a repertoire made visible, instead of a move list you have to scroll to make sense of.

![The repertoire map](imgs/position-map.png)

Each card shows its moves, their labels, and a coloured edge for how well the line is holding up - drilled clean, shaky, never drilled, excluded, or missing a reply entirely. That last one is the useful one: it's a hole in the repertoire, sitting right next to lines that run fifteen moves deep.

Lines that transpose into each other are marked with a small ⇄ that jumps you between them, so a repertoire built on move orders doesn't hide its overlaps.

Drag to pan, scroll to zoom, click a move to jump the board there and close the map.

The map can also be exported as an Obsidian **canvas**: the same cards, laid out the same way, that you can rearrange and scribble over freely.

![A map exported as a canvas](imgs/map-to-canvas.png)

## Export

The download button opens the repertoire as text, in either of two formats, with a button to copy whichever is showing to the clipboard.

![Exporting a repertoire as PGN or FEN](imgs/game-export.png)

**PGN** is the whole repertoire, not just the line you are standing on: variations come out nested in brackets, your notes as `{}` comments, and your classifications as the standard glyphs - `$1`, `$3`, `$4` and so on. It is the exact counterpart of the importer, so a repertoire exported and pasted back in comes out the same repertoire. A repertoire that starts from a position rather than the standard array carries a `[FEN]` header, so it opens where it should.

**FEN** is the position on the board right now, for pasting into an engine or another board.

Two labels are chess.com's own invention rather than standard notation - Excellent and Good - and have no glyph to be written as, so they are left off the move rather than guessed at.

## Minor features

- **Variations at any depth**, promoted, reordered, or deleted from a right-click menu - including alternatives to the repertoire's very first move, which matters most for a repertoire opened from a mid-game position, where that move is a real choice rather than an opening.
- **Move classifications** - seven chess.com-style labels, set with `1`-`7`, shown as a badge on the move and the board.
- **Board flip** from the control strip.
- **Notes and drawings** on any move - Markdown notes plus arrows and circles on the board.
- **Annotations visible from the move list** - a dot for notes, a dot for arrows, without stepping through the game to find them. The orange dot indicate the presence of a comment, a green dot represents the presence of an annotation.
- **PGN import that keeps your annotations** - comments become notes, glyphs become classifications, and variations import nested, straight from a chess.com or Lichess game.
- **Merge several repertoires in a note** into one combined tree.
- **A board with no repertoire behind it**, for showing a bare position in a note.
- **Autosave**, with a visible indicator whenever there's something unsaved.
- **A resizable, theme-aware widget** that fills the note's width.

## Installation

Chess Repertoire is **not in the community plugin store** yet, so install it by hand:

1. Download `main.js`, `styles.css` and `manifest.json` from the [latest release](../../releases/latest).
2. Create a folder named `chess-repertoire` in `<vault>/.obsidian/plugins/`.
3. Drop the three files into it.
4. Reload Obsidian and enable **Chess Repertoire** under Settings → Community plugins.

> **Upgrading from the original Chess Study?** Copy your old plugin's `storage`
> folder into the new one before enabling it, or your existing repertoires won't
> be found.

## Usage

Put your cursor where you want the board and run **Chess Repertoire: Insert FEN/PGN-Editor at cursor position** (Use the Command palette (Ctrl+P)) A modal lets you paste a PGN, paste a FEN, or start a fresh game.

To combine several repertoires in the same note into one, run **Chess Repertoire: Merge every chess repertoire in this note into one** with your cursor where you want the result. The first repertoire becomes the trunk; the others' lines are added as variations off it, and their notes fill in gaps rather than overwrite anything. This is done because I like to have the mainline first and the subvariations separated, but I also like to have a single board with all the variations together. 

## Settings

Every setting has a default in Settings → Community plugins → Chess Repertoire, and can be overridden per repertoire by adding a line to the code block:

````markdown
```chessRepertoire
chessRepertoireId: V1StGXR8_Z5jdHi6B-myT
boardColor: green
boardOrientation: black
showCoordinates: false
```
````

| Setting             | Values                                      | Description                                                |
| ------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `chessRepertoireId` | valid nanoid                                 | Which stored repertoire to render. Inserted by the command. |
| `boardOrientation`  | `white` \| `black`                           | Which way round the board starts                            |
| `boardColor`        | `blue` \| `blue-soft` \| `green` \| `brown`  | Board theme                                                  |
| `showCoordinates`   | `true` \| `false`                            | Show the a-h / 1-8 labels                                   |
| `coordinateColor`   | hex colour, e.g. `"#d08770"`                 | Colour of those labels. Leave unset to follow the theme.    |
| `boardSize`         | number of pixels                             | Widget width. Written automatically when you drag to resize. |
| `viewComments`      | `true` \| `false`                            | Whether the notes panel starts open                          |


## Keyboard shortcuts

Click a repertoire to give it the keys; click away to give them back. Works in both Reading view and Live Preview, Vim mode included.

| Key       | Action                     |
| --------- | -------------------------- |
| `←` / `→` | Previous / next move       |
| `↑` / `↓` | First / last move          |
| `1`-`7`   | Classify the current move  |
| `0`       | Clear the classification   |


## Known limitations

- Desktop only - the widget isn't adapted for touch.
- The map draws a tree, not a graph: transposing lines are two linked cards, not one shared card.

## Credits

Chess Repertoire is a fork of [chrislicodes/obsidian-chess-study](https://github.com/chrislicodes/obsidian-chess-study), with thanks to [@chrislicodes](https://github.com/chrislicodes) for the original and to [@latenitecoding](https://github.com/latenitecoding) for the FEN support it inherited.

- Chess visuals are powered by [Chessground](https://github.com/lichess-org/chessground)
- Chess logic is powered by [Chess.js](https://github.com/jhlywa/chess.js)
- The notes editor is powered by [TipTap](https://github.com/ueberdosis/tiptap)
- Icons are provided by [Lucide](https://github.com/lucide-icons/lucide)
- Everything is tied together by [React](https://github.com/facebook/react)

## License

Chess Repertoire is licensed under GPL-3.0-or-later, the same licence as the original. See [LICENSE](LICENSE).
