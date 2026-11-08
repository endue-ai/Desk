# @endue-ai/ui

The shared Desk design system: semantic colors and scale, base page styles, and framework-free
custom elements. The shell and plugin frames read the same `--desk-*` properties; a theme restyles
both. See [the design system guide](../../docs/design-system.md) and ADR 0022 for custom elements.

## Public API

- `@endue-ai/ui` (DOM-free): `tokens`, `colors`, `scale`, `material`, `terminal`, `cssVariables(theme?)`,
  `propertyOf(name)`, `tokensCss(theme?)`, `MOTION_TOKENS` and their types, `NAME`.
- `@endue-ai/ui/theme` (DOM-free, not in `ui.js`): `compileTheme(theme, scheme, url?)` turns a theme
  block into tokens, fonts and preview colours; `gate(tokens, { high?, fallback? })` fixes contrast by
  OKLCH lightness; `parseColor`, `contrast`, presets; `extractColors({ width, height, data })` (k-means in
  OKLab) and `paletteFrom(colors, scheme)` make a gated palette, the most saturated as primary.
- `@endue-ai/ui/tokens.css`: default values; `@endue-ai/ui/base.css`: page, toolbar and feedback patterns.
- `@endue-ai/ui/elements`: `defineElements()`, `elements` (by tag name) and their classes:
  `desk-button`, `desk-input`, `desk-list`, `desk-dialog`, `desk-menu`, `desk-toast`, `desk-table`,
  `desk-agenda`, `desk-stat`, `desk-card`, `desk-markdown`, `desk-progress`, `desk-edit-tier`,
  `desk-universal-view`. Elements keep native roles and keyboard behavior.
- Universal views (ADR 0087, `specs/view/v0/universal.schema.json`): `@endue-ai/ui/universal` (also in
  the root) reads entries into rows (`rowsOf`, a map's roles) and models `timelineOf`, `calendarOf`,
  `kanbanOf`, `listOf`, `textOf`, `chatOf`, `agentOf`. `<desk-universal-view>` draws them: `view`,
  `data`, `type`, `time-zone`, `state`; fires `desk-select`, `desk-move`, `desk-send`, `desk-type`.
- `desk-progress`: `label`, `value`, `max`, `detail`, `cancelable`, `delay` (300ms), fires `desk-cancel`;
  `desk-edit-tier`: `tier` (`EDIT_TIERS`), `format`, `label`, `detail` (ADR 0071). `just build-ui` builds
  `dist/ui.js`, `ui.iife.js`, `tokens.css`, `base.css` (served under `/_desk/`) and the source tokens.

```html
<link rel="stylesheet" href="/_desk/tokens.css" />
<link rel="stylesheet" href="/_desk/base.css" />
<script type="importmap">{ "imports": { "@endue-ai/ui": "/_desk/ui.js" } }</script>
<script type="module">import "@endue-ai/ui";</script>
<desk-button variant="primary">Save</desk-button>
```

## Testing

`pnpm exec vitest run packages/ui` checks tokens, the theme compiler and gate, sheets, builds, the
universal models and elements on a small DOM fake. `just test-e2e packages/runtime/e2e/design-system.spec.ts`
checks the sheets and live preferences in a Notes frame. `demo/index.html` shows the elements built.
