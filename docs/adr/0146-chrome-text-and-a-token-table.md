---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# Compositor text is cosmic-text in the compositor's atlas, and chrome reads one flat token table

## Context and Problem Statement

In Stage 2 the compositor (ADR 0140) draws the chrome the web shell draws today: title bars, edge bars
(ADR 0028), snap previews (ADR 0128), toasts and placeholders. That needs a Rust text stack: system
fonts, fallback from Latin to Hangul, CJK and emoji, subpixel positioning and a glyph atlas. Chrome must
also look the way the person's theme (ADR 0056, ADR 0057) and design system (ADR 0090, ADR 0091) say,
and change when they change. The runtime still resolves both, in TypeScript. Which text stack, and how
does the look reach the compositor without the compositor reading a theme (#51, epic #32 §3)?

## Decision Drivers

* Text follows the scene like every node: paint order, group transforms (the spread view tilts windows
  in 3D), opacity and clips
* Fallback across scripts with the machine's fonts, and the same pixels on every OS in tests
* One source for the look: what the shell's CSS reads is what the compositor reads
* Tokens flow one way, theme → table → compositor; the compositor never reads a theme or YAML

## Considered Options

* Text: cosmic-text + glyphon; cosmic-text with the compositor's own atlas and pipeline; parley +
  vello's glyph path
* Look: a `theme.tokens` call that hands the core the runtime's resolved tokens as a flat table; a
  typed chrome table made in TypeScript; the compositor resolving themes itself

## Decision Outcome

Chosen text option: "cosmic-text with the compositor's own atlas", because glyphon draws all of a
frame's text in one batch in screen space, which breaks paint order (a title under the window above it)
and the 3D transforms, and vello's glyph path brings a compute renderer for a few lines of chrome.

* cosmic-text 0.19 shapes (harfrust), lays out, ellipsizes and falls back across scripts; fontdb finds
  the system fonts; swash rasterises at the glyph's subpixel bin. Hinting is off.
* A `Text` node is plain data (box, text, style: font stack, size, weight, colour). The compositor
  lays it out (cached), packs glyphs into its own atlas (an R8 page of masks and an RGBA page for colour
  emoji, etagere, doubling up to the device limit, evicting unused glyphs at the limit) and draws each
  node as instanced quads through the node's own uniform, so text takes transforms, opacity and clips.
  A node seen flat lands on whole pixels; under a tilt it is rasterised at its rough scale.
* A CSS stack resolves to the first family present and to a weight that family has: cosmic-text takes
  a family only at a weight it has and its generic monospace gives fallback glyphs no width.

Chosen look option: "`theme.tokens` hands the core a flat table", because it carries exactly what the
shell's CSS applies, needs no second resolver, and stays the same contract when the resolver moves to
Rust.

* `theme.tokens` (`theme:manage`, `specs/bridge/v0`) carries the scheme, contrast, motion, the theme
  and design system in force and every token by camelCase name with its CSS value, `var()` references
  included. The runtime sends it on every change of the look, previews too, and never the same table
  twice. desk-core keeps the latest table in memory with a revision (`Core::theme_tokens`,
  `Core::watch_theme_tokens`).
* The compositor's `Tokens` reads values, following `var(--desk-…)` references; `ChromeTheme` maps
  them to parts with the tokens the shell's CSS uses (window `card`, `border`, `input`, `radiusLg`,
  `shadowMd`, title `text` and `textSm` at 500; toast `toastBg`, `toastFg`, `toastRadius`,
  `toastShadow`; snap `primarySoft` and `primaryBorder`). A missing or unreadable token keeps the endue
  dark value. `Chrome::set_theme` restyles every part in one pass, so the next frame is the new look.

### Consequences

* Good, because a theme or design system switch restyles chrome in one frame, from the same tokens the
  web surfaces read, and a preview shows on chrome too
* Good, because text is an ordinary node: damage, hit testing and snapshots work on it unchanged
* Good, because tests set text only in bundled fonts (Inter, Noto Sans KR and SC subsets, OFL) and
  snapshot two looks identically on every OS
* Bad, because the atlas, eviction and the pipeline are ours to keep; glyphon's were not
* Bad, because the first frame in a new family costs a layout and rasterisation (about 9 ms for 15
  titled windows on an M4 Max, release), and cosmic-text's weight and monospace quirks are worked around
* Bad, because a compositor rectangle has one shadow, so a multi-layer CSS shadow draws its strongest
  layer, and a theme's `.woff2` fonts and backdrop images do not reach chrome yet

## More Information

#51, epic #32 §3. `crates/desk-compositor/src/{text,theme,chrome.rs}`, `crates/desk-core/src/theme`,
`packages/runtime/src/theme/tokens.ts`, `specs/bridge/v0/theme.schema.json` (`ThemeTokens*`) and its
vectors, which are the tables the compositor's tests read. ADR 0140 (the compositor), ADR 0056, ADR
0057, ADR 0090, ADR 0091. `docs/ko/desk-structure.md` (화면 row) can name the text stack when it is next
revised.
