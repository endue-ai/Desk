# Desk design system

Desk keeps its design system in this repository. The shell and sandboxed plugin pages use the same
four layers: **tokens → base page styles → elements → plugin layout**. Themes replace values in the
first layer; a plugin does not need separate light and dark CSS.

## Sources and loading

| Layer | Source | Use |
| --- | --- | --- |
| Semantic colors and scale | `packages/ui/src/tokens.ts` | DOM-free `tokens`, `colors`, `scale`, `cssVariables` |
| Generated defaults | `packages/ui/src/tokens.css` | Shell import and `/_desk/tokens.css` in plugin pages |
| Page patterns | `packages/ui/src/base.css` | `/_desk/base.css`, after the default tokens |
| Interactive elements | `packages/ui/src/elements/` | `@endue-ai/ui` via `/_desk/ui.js` in a frame |
| Default theme | `plugins/theme/plugin.json` | Light, dark and high-contrast color contributions |

Run `just build-ui` after changing token values. It builds the served assets and refreshes the
committed default sheet; a unit test rejects drift. The runtime applies the resolved theme as inline
custom properties to the shell and each frame, overriding the sheet. The SDK also exposes `ctx.theme`
and its changes. No plugin needs to copy literal colors into its stylesheet.

```html
<link rel="stylesheet" href="/_desk/tokens.css" />
<link rel="stylesheet" href="/_desk/base.css" />
<script type="importmap">
  { "imports": { "@endue-ai/ui": "/_desk/ui.js" } }
</script>
<script type="module">import "@endue-ai/ui";</script>
<header class="desk-bar">
  <h1 class="desk-bar-title">Documents</h1>
  <span class="desk-bar-spacer"></span>
  <desk-button variant="primary">Open</desk-button>
</header>
<main class="desk-pane"></main>
```

`examples/plugin-hello-ui` is the minimal working example; `plugins/notes` shows a native text editor
using the same sheets. A standalone page can use the built `tokens.css`, `base.css` and `ui.js` from
`packages/ui/dist` with relative URLs. `ui.iife.js` is available for classic-script pages.

## Color roles

| Role | Custom properties | Use |
| --- | --- | --- |
| Surfaces | `background`, `card`, `muted`, `popover`, `hover` | Page, panel, sunken area, overlay, hovered row |
| Text | `text`, `text-muted` | Body and secondary text on neutral surfaces |
| Main action | `primary`, `primary-foreground`, `primary-hover` | Button fill, its ink, hover fill |
| Brand on neutral surfaces | `primary-text`, `primary-subtle`, `primary-soft`, `primary-border` | Links, tints and borders |
| Status | `success`, `warning`, `danger`, `info` | Each has `-foreground`, `-text`, `-soft`, `-border` companions |
| Structure | `border`, `input`, `ring` | Dividers, control borders, keyboard focus |
| Floating layers | `tooltip`, `tooltip-text`, `scrim`, `shadow-sm`, `shadow-md`, `shadow-lg` | Overlays and their text |
| Categories | `chart-1` through `chart-8` | Assign a stable color per subject, in order |

Every name above has the prefix `--desk-`. Put `*-foreground` text on the corresponding solid fill;
use `*-text` on neutral surfaces. Do not use a fill token as link text or as the focus ring. The default
theme tests check text at 4.5:1, controls at 3:1, and key text at 7:1 in high contrast. Theme authors
must check their own pairs in both schemes. Status needs a label or icon as well as color.

## Shared scale

- Type: `--desk-font-sans`, `--desk-font-mono`; sizes `--desk-text-2xs` through `--desk-text-4xl`.
  Use `text-sm` (14px) for UI, `text-base` (16px) for documents; reserve 11px for compact labels.
- Spacing: `--desk-space-1`, `2`, `3`, `4`, `5`, `6`, `8`, `10`, `12`, `16`, on a 4px grid.
- Control heights: `--desk-control-xs` (28px), `sm` (32px), `md` (40px), `lg` (48px).
- Radius: `--desk-radius-sm`, `md`, `lg`, `full`.
- Motion: `--desk-motion-fast`, `base`, `slow`, `theme`. The runtime sets all four to `0ms` under
  reduced motion, including when the user overrides the OS preference inside Desk.

The shell's existing unprefixed scale names alias these tokens. Plugin frames use the prefixed names.
Theme contributions normally change colors; shared measurements make controls consistent across pages.

## Replacing a theme

Use the existing `contributes.themes` entries of a policy plugin. Tokens are camelCase in manifests:
`primaryForeground` becomes `--desk-primary-foreground`, `space3` becomes `--desk-space-3`.
Unsplit numeric names such as `--desk-space3` remain aliases for existing custom-token consumers.
Themes for the current scheme layer in contribution order; high-contrast entries layer last when
high contrast is active. A later theme may override one role or the full color set. No new settings
format, custom CSS injection or plugin permission is needed.

```json
{
  "id": "example.paper.dark",
  "name": "Paper dark",
  "scheme": "dark",
  "tokens": {
    "background": "#171b20",
    "card": "#202830",
    "primary": "#b9dbff",
    "primaryForeground": "#132b40",
    "primaryHover": "#d5eaff",
    "primaryText": "#b9dbff",
    "ring": "#b9dbff"
  }
}
```

For a complete replacement provide the `colors` keys for both schemes and test their contrast pairs.
Custom tokens are permitted. Removing a theme removes its custom variables rather than leaving stale
values. `desk.theme.light`, `.dark`, `.contrast` and `.motion` exercise the standard preferences.

`--desk-accent` remains supported as the legacy brand fill. A contribution containing only `accent`
updates the primary fill, hover, text and ring, with the old background as the fill's ink; explicit
semantic roles in that contribution take precedence. A contribution with `primary` updates the legacy
`accent` value unless it provides both. New code should use the semantic roles. Desk's legacy accent
means the brand fill, while the web product's accent means a hover surface: do not interchange them.

## Theme conformance

A theme is the design system's values, so every UI reads colour, font family, text size, corner radius
and duration from `--desk-*` tokens only: the shell, `@endue-ai/ui`, the examples and every plugin page,
in stylesheets, `<style>` blocks, `style=""` attributes and the strings scripts paint with (canvas too;
read a token with `getComputedStyle(document.documentElement).getPropertyValue("--desk-chart-1")`).
Derived values stay token-based: `color-mix(in srgb, var(--desk-text) 8%, transparent)`,
`calc(var(--desk-radius-md) - 2px)`, `calc(var(--desk-text-sm) - 1px)`. A file's own colours (a
document's text, a highlight, an image's checkerboard) are not the theme's: mark them with a
`theme: content` comment on the line, or on the line that opens the rule.

`node scripts/ui-lint.mjs` checks this in `just check` as a ratchet. `scripts/ui-lint-baseline/<target>.json`
holds the literals a plugin (or `_runtime`, `_ui`, `_examples`) may still have; more fail, fewer are
reported until `node scripts/ui-lint.mjs --update` lowers the baseline (or deletes it at zero). `--list` names each
literal. A plugin with no baseline keeps a `tests/theme.test.ts` that expects `lintPlugin("<folder>")` to
be empty. The design behind it is `docs/ko/theme-requirements.md` (TP) and ADR 0056.

## Page and feedback patterns

Use `.desk-bar`, `.desk-bar-title` and `.desk-bar-spacer` for a common toolbar; `.desk-pane` for a
scrolling flex/grid pane and `.desk-details` for its details column. These classes only arrange content;
use semantic headings, labels and native landmarks for its meaning.

An empty state (`.desk-empty`) says what belongs here and provides the next useful action. An error
(`.desk-error`, `role="alert"` for a new failure) explains what failed and includes a retry or recovery
action when one is possible. Keep relevant content visible after a recoverable failure. `.desk-muted`
is for secondary text, and `.sr-only` supplies names without a visible label.

```html
<div class="desk-error" role="alert">
  <p>The file could not be read. Check that it still exists.</p>
  <desk-button id="retry">Try again</desk-button>
</div>
<desk-progress label="Reading document" cancelable hidden></desk-progress>
```

Use the existing `<desk-progress>` for long work: unhide it when work starts; its default 300ms delay
avoids a flash for fast work. Set `value` and `max` when the total is known; omit `value` otherwise.
Listen to `desk-cancel` and abort the underlying operation. Hide it on success, cancellation or error;
replace a failure with an actionable error. Parsing must yield or run in a worker so progress and
cancellation stay responsive. Announce status with an appropriately scoped `role="status"`; avoid
re-announcing the entire page. Controls retain visible focus and work with keyboard input.

## Validation

Run `pnpm exec vitest run packages/ui packages/runtime/src/theme.test.ts plugins/theme`, `just check`,
`just check-app`, and `just test-e2e packages/runtime/e2e/design-system.spec.ts`. The browser test loads
Notes with the served shared sheets and checks live light/dark and reduced-motion changes inside its
sandbox. Use `just test-e2e` only: on macOS it runs the supported Linux container.
