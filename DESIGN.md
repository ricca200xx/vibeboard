# Design

A native-feeling macOS tool. The agents' work is the content; the chrome recedes. All values live as tokens at the top of `src/styles.css`, defined for dark and for `:root[data-theme='light']`. The theme follows the Mac unless Settings says otherwise (`src/theme.ts`).

## Colour

- Neutrals carry the interface: `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--line`, `--line-2`, `--text`, `--text-2`, `--muted`, `--faint`.
- `--ink` is the theme's foreground as RGB channels, for translucent hover and fill states: `rgb(var(--ink) / 0.08)`. Never write a translucent white.
- Coral (`--accent`) goes on the one primary action, on what is selected and on an agent that is working. Nowhere else.
- `--needs`, `--done`, `--danger`, `--warn`, `--ok`, `--info`, `--purple` mean status and link kinds only.
- Colours a person picks (shapes, sticky notes, groups) are their content and stay as picked. The saved default ink `#ece8e2` means "the theme's text colour": pass stored colours through `themed()`.
- The document sheet (`.paper`) is white paper in both themes.

## Surfaces

- `--glass` with `backdrop-filter: var(--blur)`: bars and rails that float over the board.
- `--popover` with the same blur: menus, sheets, tooltips.
- `--panel`: cards on the board. Nodes are never translucent, so what sits under them cannot bleed through their text.
- `--shadow` only for what floats above other interface, `--shadow-sm` for rails and nodes.

## Type

- The system font (`--font`, San Francisco on a Mac). The base size is 13px; the scale is 11 to 13 for controls and text, 15 for sheet titles, 20 and 32 for the two empty and home headlines. Sentence case always.
- `--mono` (JetBrains Mono) is for terminals, code, diffs, paths and commit hashes. Numbers elsewhere use `font-variant-numeric: tabular-nums`.

## Shape and controls

- Radii: 6 inside a control, 8 for controls, 10 for small floating labels, 14 for panels and sheets. Full circles only for round buttons and ring petals.
- Control height 26 to 32. Lucide icons at stroke 1.6.
- Selected in a segmented control is a neutral raised segment (`--seg-on`), not coral.
- Every control with no visible word has a `title`, which `Tips` shows as a tooltip. Say what pressing it does, not what it is called.
- Console actions appear on hover or keyboard focus. Status is always visible, as a dot and a plain word.

## Motion

Feedback only: hover and press within 0.12s, a menu or petal opening within 0.16s. Nothing performs an entrance.
