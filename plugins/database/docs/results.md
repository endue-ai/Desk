# The Database plugin's pinned results and comparisons

A result kept through later runs, and two results compared row by row (PG-26, ADR 0329). The rest of the
plugin is in [`features.md`](features.md); a change to pinning or comparing adds its line here.

- Database: pin the result tab (Pin in the result's toolbar) keeps a console's result through its later
  runs, as a tab after the run's tabs named after its statement and the time it ran (`select * from stock ·
  14:03:22`; the tab's title holds the whole statement). A pinned result is kept as the server sent it: its
  rows are never edited, and Explain never reads it as the run's plan. Database: unpin a result tab (the
  button says Unpin on a pinned tab) lets it go; closing the console lets its pins go. Pins last for the
  plugin's session. A table view pages its table on the server, so it has no pins: its pages are compared
  by run again and compare.
- Pinned results of every console keep under 64 MiB of the frame's memory, each counted by its rows (about
  two bytes a character, and a cell's and a row's overhead). A pin past the limit lets go of the oldest
  first and the status line names each one and its console; a result past the limit alone is not pinned.
- Database: compare two results (Compare) takes the result on screen and another (asked for when there is
  more than one: every console's results and pinned ones), and the key: the primary key first when both
  results carry the same one (the catalog's, for the one table a plain SELECT or a table view reads; a pin
  keeps it), then row position, then any column both have. The command takes `key` (`primary`,
  `position`, or columns joined by commas), `before` and `after`.
- Database: run again and compare with before runs a console's last run again, in the same mode (or a table
  view's page), and compares its result with what it showed before, by the primary key when both carry
  it, else by row position, without asking.
- The comparison opens in a panel: the two results, what the rows were paired by and why, the counts of
  changed, added, removed and the same, the columns only one side has (listed, not compared), and a row per
  difference, a changed cell with its value before struck and its value after. Columns pair by name (a
  repeated name by its occurrence); cells compare as the text the server sent, NULL apart from every text.
  A key a result repeats pairs its rows in order, and the panel says how many repeat. A result with more
  rows than it loaded is compared on the rows loaded, and the panel says so.
- Comparing runs in a worker of its own past 20,000 cells (`compare/worker.js`), so two large results are
  never paired on the frame's thread; a comparison takes at most 2,000,000 cells a side and refuses past
  that with how to narrow it. It keeps the first 1,000 differences, with exact counts of all.
- Database: copy the difference and Database: export the difference (Copy and Export in the panel) write
  it in the plugin's formats (TSV, CSV, JSON, Markdown, INSERT, UPDATE) as a result of its own: a column
  `change` (`added`, `removed`, `changed (before)`, `changed (after)`; `_change` when a result has its own
  `change`), then the columns both have, then those only one side has. An export goes to
  `~/Downloads/difference-<time>.<ext>`.

Modules: `compare/` (`diff.js`, `client.js`, `worker.js`, `pins.js`), `features/compare/`, `tabs.js`.
