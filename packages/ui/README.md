# @endue-ai/ui

What a plugin page imports for a native-looking surface: the theme tokens, `tokens.css`, and six
framework-free custom elements whose CSS reads only the `--desk-*` custom properties, so any theme
that redefines them (`desk.theme`) restyles them. Why custom elements: `docs/adr/0022-*.md`.

Layer: Web runtime (see `docs/architecture.md`).

## Public API

- `@endue-ai/ui` (no DOM, safe in Node): `tokens` (`background` #141416, `card` #1e1d21, `border`
  #333136, `text` #f2f0f5, `textMuted` #b0adb7, `accent` #b6a3f5), `cssVariables(theme?)`
  (`--desk-text-muted`, ...), `tokensCss(theme?)` (one `:root` rule), `ThemeTokens`, `NAME`.
- `@endue-ai/ui/elements`: `defineElements()`, `elements` (by tag name) and the classes.
  - `<desk-button variant="primary" disabled>`: a button named by its text.
  - `<desk-input label value placeholder type disabled>`: a native input in a label.
  - `<desk-list label>`: a listbox of its children; `selectedIndex`; `desk-select` `{ index, item }`.
  - `<desk-dialog label open>`: modal; `show()`, `close()`; Escape fires `cancel`, then `close`.
  - `<desk-menu label open>`: `show(anchor)`, `toggle(anchor)`, `close()`; `desk-select`, `close`.
  - `<desk-toast tone="error" dismiss-label>`: `show(message, { duration })`; `close`.
- `pnpm --filter @endue-ai/ui build`: `dist/ui.js` (an ES module that defines the elements on import),
  `dist/ui.iife.js` (the same as a classic script, global `DeskUI`) and `dist/tokens.css`.

```html
<link rel="stylesheet" href="tokens.css" />
<script type="importmap">{ "imports": { "@endue-ai/ui": "./ui.js" } }</script>
<script type="module">import "@endue-ai/ui";</script>
<desk-button variant="primary">Save</desk-button>
```

The app does not serve the bundle yet. `demo/index.html` shows every element: build, then open it.

## Testing

```bash
pnpm exec vitest run packages/ui
```

The element tests run in Node on a small DOM fake (`src/elements/test-dom/`), not in a browser.
