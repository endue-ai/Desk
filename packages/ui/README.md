# @endue-ai/ui

The shared Desk design system: semantic colors and scale, base page styles, and framework-free
custom elements. The shell and plugin frames read the same `--desk-*` properties; a theme restyles
both. See [the design system guide](../../docs/design-system.md) and ADR 0022 for custom elements.

## Public API

- `@endue-ai/ui` (DOM-free): `tokens`, `colors`, `scale`, `material`, `terminal`, `cssVariables(theme?)`,
  `propertyOf(name)`, `tokensCss(theme?)`, `MOTION_TOKENS` and their types, `NAME`.
- `@endue-ai/ui/theme` (DOM-free, not in `ui.js`): `compileTheme(theme, scheme, url?)` turns a theme
  plugin's block into tokens, fonts and preview colours; `gate(tokens, { high?, fallback? })` checks the
  contrast pairs and fixes foregrounds by OKLCH lightness; `parseColor`, `contrast`, presets.
- `@endue-ai/ui/tokens.css`: default values; `@endue-ai/ui/base.css`: page, toolbar and feedback patterns.
- `@endue-ai/ui/elements`: `defineElements()`, `elements` (by tag name) and their classes:
  `desk-button`, `desk-input`, `desk-list`, `desk-dialog`, `desk-menu`, `desk-toast`, `desk-table`,
  `desk-agenda`, `desk-stat`, `desk-card`, `desk-markdown`, `desk-progress`. Elements keep native roles and keyboard behavior.
- `desk-progress`: `label`, `value`, `max`, `detail`, `cancelable`, `delay` (300ms default); `desk-cancel`
  asks the caller to abort. Reduced motion follows the OS and Desk's preference.
- `just build-ui`: builds `dist/ui.js`, `ui.iife.js`, `tokens.css`, `base.css`; refreshes source token CSS.

The app serves the ES module and sheets at `/_desk/ui.js`, `/_desk/tokens.css`, `/_desk/base.css`.

```html
<link rel="stylesheet" href="/_desk/tokens.css" />
<link rel="stylesheet" href="/_desk/base.css" />
<script type="importmap">{ "imports": { "@endue-ai/ui": "/_desk/ui.js" } }</script>
<script type="module">import "@endue-ai/ui";</script>
<desk-button variant="primary">Save</desk-button>
```

## Testing

`pnpm exec vitest run packages/ui` checks tokens, the theme compiler and gate, sheet generation, builds
and elements on a small DOM fake. `just test-e2e packages/runtime/e2e/design-system.spec.ts` checks the shared sheets and live
preferences in a sandboxed Notes frame. `demo/index.html` shows the elements after a build.
