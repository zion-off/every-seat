# Every Seat: TV design

Every screen of the Fire TV app follows this sheet. All values live in one file, `src/styles/tokens.ts`; no colour or size is written anywhere else. Sizes are given in 1080p pixels and scaled with `scaleUxToDp`.

## Principles

1. **Ten-foot reading.** The viewer sits across the room. Body text is at least 24 px, titles at least 40 px, and every text/background pair meets WCAG AA (4.5:1 for text, 3:1 for large text and graphics).
2. **Focus is the interface.** There is no pointer. The focused element must be unmistakable from the sofa: it grows slightly, gets a crisp amber outline and a faint glow. Focus is never lost and never trapped, and Back always leaves.
3. **Content first.** Films are shown as pictures with a credit, not as boxes of text. The focused film is explained in a hero area above the row: what it contains for the people on the couch.
4. **Calm.** Dark, low-glare surfaces. One accent. Few, quiet movements. Nothing flashes, pulses or loops on screen; this is an app for people who are sensitive to exactly that.

## Palette

Derived from the logo: five dark navy armchairs on a deep navy field, one chair lit amber.

| Token | Value | Use |
| --- | --- | --- |
| `background` | `#0d111c` | screen base |
| `backgroundTop` | `#1d2332` | top of the screen wash (the logo field) |
| `surface` | `#161c2a` | tiles, panels, buttons at rest |
| `surfaceRaised` | `#1d2332` | cards, the player bar |
| `surfaceFocused` | `#2a3350` | a surface that holds focus |
| `line` | `#33405e` | dividers, resting outlines, seek track |
| `text` | `#f3f5fb` | primary text (16:1 on `background`) |
| `textMuted` | `#aeb7cc` | secondary text (9:1 on `background`) |
| `accent` | `#ffbe5c` | the one accent: focus outline, primary action, selection, counts |
| `accentDeep` | `#e8973a` | pressed state, strong heat |
| `onAccent` | `#1a1206` | text on an amber fill (11:1) |
| `scrim` | `rgba(13,17,28,0.72)` | picture overlays that stay see-through |
| `scrimStrong` | `rgba(13,17,28,0.94)` | panels over the picture that carry text |
| `glow` | `rgba(255,190,92,0.05)` | one layer of the focus halo; six are stacked to fade out over 14 px |

The heat ramp for the seek bar goes from pale amber to ember: `#ffd899`, `#ffbe5c`, `#e8973a`, `#e0612f`, `#d94040`, each with a lighter "played" tone. Intensity is also written as a number and a word wherever it matters, never by colour alone.

## Type

One family, the platform font (no bundled font). Weights 400 and 700 only.

| Token | Size / line | Use |
| --- | --- | --- |
| `small` | 24 / 32 | credits, legends, hints; the smallest text allowed |
| `body` | 28 / 36 | descriptions, labels, buttons, times |
| `title` | 40 / 48 | screen and card titles, names on tiles |
| `display` | 56 / 64 | the hero film title, the welcome headline |

## Space, shape, motion

- **Spacing** (8 px scale): `xs 8`, `sm 16`, `md 24`, `lg 32`, `xl 48`, `xxl 64`.
- **Safe area:** 96 px left and right, 56 px top and bottom (5% title-safe margin is 96 x 54). Text, tiles, buttons, cards and badges stay inside it. Only backgrounds and the film itself bleed to the edge.
- **Radii:** `sm 8` chips and bars, `md 16` buttons and cards, `lg 24` tiles, `pill 999` badges and counters.
- **Motion:** focus and state changes take 150 ms, ease-out, on the native driver (opacity and transform only). Panels and cards fade in over 150 ms. Nothing else animates.

## Focus

Every focusable element is a `Focusable` (or a themed `Button`, which wraps the same behaviour).

- Scale to `1.05` for tiles and `1.04` for buttons, chips and the seek bar, 150 ms.
- A 3 px amber outline sits 4 px outside the element, drawn on its own layer so it can fade without changing layout.
- A faint amber halo (`glow`) sits behind the outline and fades out within 14 px.
- Resting elements have a quiet `line` outline or none; they never use amber, so amber always means "here".
- A selected (not focused) element shows a filled amber check or dot, never an outline.
- Layouts leave 16 px of room around every focusable for the outline and scale.

## Screens

**Welcome and About.** Left-aligned column inside the safe area: the headline at `display`, the short paragraphs at `body`, one primary button. The logo mark sits on the right. Nothing is centred in the middle of the screen.

**Couch.** Header "Who's watching?" at `title` with one line of help at `body`. People are tiles in a grid of four columns, each with an initial in a circle, the name at `title`, and what they have switched on at `small`. A selected person has a filled amber check. Below the grid: a primary "Continue" and a quiet "About". The first tile holds focus on arrival. Grids wrap to a second row; nothing leaves the safe area.

**Films.**
- Top bar: logo mark and "Every Seat" on the left; on the right a "Couch" button that shows who is on the couch and goes back to the couch screen.
- Hero: the film's still fills the right of the hero area and fades into the background on its left. On the left: the title at `display`, the byline and length at `body`, then the comfort summary, one pill per kind of moment this couch is protected from ("2 flashes", "1 loud sound", "3 scares") with the strongest intensity, or "Nothing to soften for this couch". Films that have not been analysed say so.
- Row: one row of 16:9 stills at 408 x 230 with the name at `body` below. Focus moves the hero. The row fits inside the safe area; a longer row scrolls with the focused tile kept visible.
- Credit line at the bottom in `small`.
- Back from a film returns to the same tile.

**Player.**
- Controls: a bar in the lower part of the screen inside the safe area, on `scrimStrong`, appearing for six seconds after any key. Film name and time on one line, the heat seek bar, then a legend and, at the right, who is on the couch as a row of initials (no pill, no fill at rest; it takes focus and opens the couch panel).
- The seek bar is the signature visual: a 12 px track with the moments the couch cares about drawn on it in heat colours, at least 1.2% wide so none disappears. The thumb is amber. Left/Right step ten seconds.
- Comfort cards (heads-up) are at most 1040 px wide, sit at the left of the lower third, never in the middle of the picture and never over the centre of the frame where faces are. They are quiet, `surfaceRaised` with an amber top edge, three buttons in a row: **Soften**, **Watch**, **Tell me**. The card takes no focus on its own; Select on the remote opens it.
- Badges (flash softened, sound lowered meter) are small `pill` shapes at the top left inside the safe area. The meter is 12 bars, 8 px wide, amber, calm and static except for the level.
- Couch panel: a right-hand panel of 680 px on `scrimStrong` over the picture; it traps focus while open and closes with Back, returning focus to the chip.

## Components

| Component | Rules |
| --- | --- |
| `Focusable` | pressable plus the focus rules above; passes `focused` to its children |
| `Button` | KUIC `Button` with the theme below, wrapped in the same focus layers; `primary` = amber fill with `onAccent` text, `secondary` = `surface` fill with `text` |
| Tile | 24 px radius, picture fills it, name below at `body` |
| Pill | 999 radius, `surfaceRaised`, `small` or `body` text, 8 x 16 padding |
| Card | 16 px radius, `surfaceRaised`, 24 px padding, amber top edge 4 px |

KUIC theme: `src/styles/theme.ts` maps the tokens onto the KUIC theme (text colours, button fills, borders, radii, font sizes) so any KUIC component inherits them.

## Layers

Dim overlay 10, controls 30, couch panel 40, comfort cards and badges 50.

## Assets

- Icon (Settings and Apps), launcher tile, background and splash are cut from the logo.
- Film stills are single frames from the films, credited on screen and in `LICENSE-THIRD-PARTY`: Blender Foundation | studio.blender.org, CC BY. The test pattern uses a crop of the logo.

## Acceptance

- No hex colour, `rgba(` or font size outside `tokens.ts` and `theme.ts`.
- Body text 24 px or larger; titles 40 px or larger.
- Nothing important outside the 96 x 56 safe margin.
- Every focusable shows the scale, outline and glow; a D-pad walk of every screen never loses focus, and Back always works.
- Accessibility roles, labels and announcements are unchanged by styling.
