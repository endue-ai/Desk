/**
 * The engine's own parts in every page: scrollbars, checkboxes, radios, ranges, selects and fields.
 * Off-screen Chromium draws classic scrollbars in its own light (or, under `color-scheme: dark`, grey)
 * look, never the theme's, and form controls in the page's `color-scheme`, light unless the page says
 * otherwise (#156). These rules give
 * each page the theme's scheme, from the `data-scheme` the SDK and the runtime set where they set the
 * theme's tokens (dark before they do, as the default tokens are), thin scrollbars with a thumb of a
 * token the contrast gate holds against the page's grounds over a clear track, and the design
 * system's check accent. `tokens.css`, the one sheet every page links, carries them after the tokens
 * (ADR XXXX). Every selector is inside `:where()`, so it weighs nothing and a page's own rule wins.
 * `scrollbar-color` is inherited: a box that draws its own bars with `::-webkit-scrollbar` sets it
 * to `auto`, as Chromium ignores those pseudo-elements under any other value.
 */

/** The token the thumb is drawn with: gated 3:1 against `background` and `card` (gate.ts). */
export const SCROLLBAR_THUMB = "input";

/** The rules, as `tokensCss()` appends them. */
export const NATIVE_CSS = `/* The engine's own parts follow the theme: its scheme, the scrollbars and the check accent. */
:where(:root, [data-scheme="dark"]) {
  color-scheme: dark;
}
:where([data-scheme="light"]) {
  color-scheme: light;
}
:where(:root, [data-scheme]) {
  accent-color: var(--desk-check-accent);
  scrollbar-color: var(--desk-${SCROLLBAR_THUMB}) transparent;
}
:where(*) {
  scrollbar-width: thin;
}
`;
