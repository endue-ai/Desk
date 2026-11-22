# Copying from endue.database

Copy as (`endue.database.copy`) copies the result on screen, or the grid's selected block, as TSV, CSV,
JSON, Markdown, INSERT or UPDATE statements. It works the same from a key or a button in the page and
from the palette. The value viewer's Copy and `endue.database.copy-value` ("Database: copy the cell's
value") copy one value whole.

- The clipboard: the Clipboard API first (`ui/clipboard.js`). Chromium lets a page write only while it
  has the focus and a key or press in it is a few seconds old. The desk gives the plugin's page that
  press when the person runs its command or answers its question in the palette, and lends it the focus
  when another window is in use (ADR 0318). A copy waits up to 1.5 s for the page's focus, which the
  palette gives back as it closes. Where the Clipboard API refuses, the copy command on a hidden
  textarea takes over, with the text only.
- A block as cells: a copy as TSV, and the grid's Mod+C, carry an HTML table of the same cells beside
  the text, so a spreadsheet pastes cells. The table has no header row (TSV has none); NULL is an
  empty cell and a line break stays in its cell.
- Large copies (`ui/copy-size.js`): past 100,000 cells (weighed before the text is built) or 10,000,000
  characters, a copy asks first in the palette ("Copy 120,000 cells to the clipboard?") and copies
  nothing on No ("Nothing copied."). A block that large from Mod+C goes to Copy as TSV, which asks.
- Reading: a plugin page never reads the clipboard but through a paste, whose event carries its text.

Tests: `tests/clipboard.test.ts`, `tests/copy-size.test.ts`, `tests/grid-copy.test.ts`, the runtime
e2e `packages/runtime/e2e/database-clipboard.spec.ts` and the app e2e `e2e/specs/database-clipboard.spec.ts`.
