# Results of any size (PG-22)

A PostgreSQL console's single read scrolls to its end without running again and without filling the
frame's memory (ADR 0352). Modules: `ui/engines/pg-cursor.js` (the cursor on the session),
`ui/engines/pg-rows.js` (a fetch in the console's turn), `ui/rows/window.js` (the rows held),
`ui/rows/control.js` (what the console asks for), `ui/grid/window.js` (the grid as it scrolls),
`ui/features/rows/` (the commands).

## What reads through a cursor

- One statement run with Run or Run all in a PostgreSQL console: `SELECT`, `WITH ... SELECT`, `VALUES` or
  `TABLE`, without `FOR UPDATE` or `INTO`. Scripts, writes, EXPLAIN, agents' runs, table views (which
  page with LIMIT and OFFSET) and the other engines read as before.
- The read is declared once on the console's kept session (`DECLARE endue_desk_rows SCROLL CURSOR FOR
  ...`) and its first page fetched (`FETCH FORWARD <page>`), in one `db.script` call. The page is the
  `max-rows` setting, 10,000 rows at most. A read that fits one page ends its cursor at once and reads as
  any result did. A read with parameters (PG-21) is declared with its bound values, and scrolls the
  same way.

## Scrolling

- The grid asks for the next page when it is two screens from the last row held, and for the previous
  one near the first: `FETCH FORWARD` from where the cursor is, or `MOVE ABSOLUTE` then `FETCH`. One
  request runs at a time per console, in the console's turn, and Cancel stops it.
- The frame holds at most four pages (2,000 rows when the page is smaller) and 32 MiB of values: pages
  far from view are let go and fetched again when the person scrolls back. The rows on screen and the
  cell cursor stay in place as pages come and go; the columns keep the widths the first page gave them.
- The summary says `Rows a–b of at least n` until the end is reached, then the exact count.
- Database: count every row of the result moves the cursor to its end (`MOVE FORWARD ALL`) and says the
  total; the rows held stay.
- Values are held whole: the grid cuts a long value on screen and the value viewer shows it all.

## Sorting and filtering

- A result not fully read cannot be sorted or filtered by the rows held. The grid's sort keys and quick
  filters go into the statement, which runs again as `SELECT * FROM (<statement>) AS endue_rows WHERE ...
  ORDER BY ...` (the server sorts every row), and the status line says so. The statement in the editor
  stays as typed.
- Database: fetch every row of the result holds them all, up to 100,000; the result is then whole, and
  sorts and filters in the frame. Past 100,000 it says to put ORDER BY or WHERE into the statement.
- The typed filter (`/`) and find (Mod+F) look at the rows held.
- The Map (PG-46) and the Chart (PG-44) draw a whole result: opening one on a result not fully read
  fetches every row first, as Fetch every row does, and the grid's result is whole after it. Past
  100,000 rows they draw the rows held and say so (the map's row picker reads Rows held).
- Compare results and the assistant's sample take the rows held; compare says the result is partial.
- Export and copy cover the rows held and say the result is partial (PG-61); Database: export every row to a file writes all of them
  ([`export-all.md`](export-all.md)).

## Transactions

- Outside a transaction the cursor lives in a transaction of the plugin's own (`START TRANSACTION`),
  which the header does not show: the console reads Idle. It ends with `END` before the console's next
  run of any kind, when a read fits one page, or when the session closes.
- Inside the person's transaction (one they began, or manual commit, PG-20, whose BEGIN goes first in
  the same call) the cursor is theirs: the next run sends `CLOSE endue_desk_rows` first, and their COMMIT
  or ROLLBACK would end it anyway.
- Through a pooler (the connection's pooler option, PG-14) a read outside the person's transaction keeps
  no cursor and reads one page as before: the pooler may hand the next call to another server. Inside
  their transaction the pooler keeps one server, and the read scrolls.
- A cancel or an error during a fetch ends the cursor (`ABORT` of the plugin's own transaction). In the
  person's transaction the cancel fails it, as any cancelled statement does. The rows held stay, and the
  summary says the rest cannot be read.
- A lost session (PG-105) takes its cursor with it: the summary says at once that the rows past those
  held went with it, and the rows held stay. The automatic reconnect and a scroll fetch nothing on the
  new session; run the statement again to read on.
- Pending changes in the grid stop the window from moving until they are submitted or dropped.
