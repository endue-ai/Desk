# @endue-ai/ui

What a plugin page imports for a native-looking surface: the theme tokens, `tokens.css`, and eleven
framework-free custom elements whose CSS reads only the `--desk-*` custom properties, so any theme
that redefines them (`desk.theme`) restyles them. Why custom elements: `docs/adr/0022-*.md`. Layer:
Web runtime (`docs/architecture.md`).

## Public API

- `@endue-ai/ui` (no DOM, safe in Node): `tokens` (`background` #141416, `card` #1e1d21, `border`
  #333136, `text` #f2f0f5, `textMuted` #b0adb7, `accent` #b6a3f5), `cssVariables(theme?)`
  (`--desk-text-muted`, ...), `tokensCss(theme?)` (one `:root` rule), `ThemeTokens`, `NAME`.
- `@endue-ai/ui/elements`: `defineElements()`, `elements` (by tag name) and the classes.
  - `<desk-button variant="primary" disabled>`, `<desk-input label value placeholder type disabled>`.
  - `<desk-list label>`: a listbox of its children; `selectedIndex`; `desk-select` `{ index, item }`.
  - `<desk-dialog label open>`: modal; `show()`, `close()`; Escape fires `cancel`, then `close`.
  - `<desk-menu label open>`: `show(anchor)`, `toggle(anchor)`, `close()`; `desk-select`, `close`.
  - `<desk-toast tone="error" dismiss-label>`: `show(message, { duration })`; `close`.
  - `<desk-table label>`: `columns` (`{ key, label, sortable }`), `rows` (`{ cells, values }`), `sort`,
    `selectedIndex`, `activeRow`, `rowOf(node)`; `desk-select` `{ index, row }`, `desk-sort` `{ key, direction }`.
  - `<desk-agenda label time-zone now locale>`: `events` (`{ title, start, end, allDay, detail }`), a
    now-line and `data-past`; `selectedIndex`, `activeEvent`, `eventOf(node)`; `desk-select` `{ index, event }`.
  - `<desk-stat label value unit>`, `<desk-card heading>`, `<desk-markdown source>` (a CommonMark
    subset, no raw HTML or images; links fire `desk-link` `{ href }`).
  - `desk-list` and the last five take `density="compact"`.
- `pnpm --filter @endue-ai/ui build`: `dist/ui.js` (an ES module that defines the elements on import),
  `dist/ui.iife.js` (the same as a classic script, global `DeskUI`) and `dist/tokens.css`.

```html
<link rel="stylesheet" href="tokens.css" />
<script type="importmap">{ "imports": { "@endue-ai/ui": "./ui.js" } }</script>
<script type="module">import "@endue-ai/ui";</script>
```

The app does not serve the bundle yet (the runtime's e2e server does, at `/_desk/ui.js`).
`demo/index.html` shows every element: build, then open it.

## Testing

`pnpm exec vitest run packages/ui`, in Node on a small DOM fake (`src/elements/test-dom/`).
