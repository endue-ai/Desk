/** Desk theme tokens, kept in sync with the endue design system. */
export const tokens = {
  background: "#141416",
  card: "#1e1d21",
  border: "#333136",
  text: "#f2f0f5",
  textMuted: "#b0adb7",
  accent: "#b6a3f5",
} as const;

export type ThemeTokens = { readonly [K in keyof typeof tokens]: string };

/** The tokens as CSS custom properties: `textMuted` → `--desk-text-muted`. */
export function cssVariables(theme: ThemeTokens = tokens): Record<string, string> {
  return Object.fromEntries(
    Object.entries(theme).map(([name, value]) => [
      `--desk-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      value,
    ]),
  );
}
