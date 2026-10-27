# @endue-ai/ui

Design tokens and shared components, kept in sync with the endue design system.

Layer: Web runtime (see `docs/architecture.md`). Status: tokens only.

## Public API

- `tokens`: `background` #141416, `card` #1e1d21, `border` #333136, `text` #f2f0f5,
  `textMuted` #b0adb7, `accent` #b6a3f5.
- `cssVariables(theme?)`: the tokens as CSS custom properties (`--desk-text-muted`, ...).
- `ThemeTokens`: the token shape.
- `NAME`: the package name.

## Testing

```bash
pnpm exec vitest run packages/ui
```
