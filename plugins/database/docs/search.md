# The Database plugin's value search

Where a value is stored, found without knowing the table. The rest of the plugin is in
[`features.md`](features.md); a change to the search adds its line here.

- Database: search for a value in tables opens a panel per connection: the text or number to find, equals,
  contains, starts with or a regular expression (PostgreSQL `~` / `~*`, MySQL and SQLite `REGEXP`), ignoring
  case or not, the schemas (from the explorer's list), the tables (names, `schema.name`, `*`), and the kinds
  of column to look in: text, numbers, uuid, JSON's strings and numbers (never its keys), dates as text. Only
  a column whose type can hold the value is read: a number is never looked for in a uuid, nor a word in a
  number; arrays, booleans and bytes are not searched.
- Before it starts it says what it reads: how many tables and about how many rows. A table estimated past
  the size limit (1,000,000 rows) is left out unless asked; a production connection asks first with that
  sentence. A read-only connection searches: a search only reads.
- Tables are read one after another, each in its own read-only transaction with its own statement timeout
  (10 s, at most 300) and row limit (100, at most 1000). Progress and a running count show while it runs;
  Cancel (or Escape) stops the statement running, on that table's session alone, and every table after it.
  A partitioned table is read once, through itself: its partitions are never read on their own.
- The matches are grouped by table and column with their counts, whether an index served the search, and up
  to 1000 hits kept in all. A column opens its table filtered to its matches, a hit to its row: by the
  primary key, else by `ctid` (PostgreSQL, said so; a partitioned table's also by the partition the row lives
  in), `rowid` (SQLite) or the match (MySQL). The tables not searched are listed with why: the size limit, no
  permission, the timeout.
- `endue.database.search-data` with a value answers the counts and the first keys, read-only and under the
  same limits; `.search-data-cancel` stops it. The explorer's `f` opens it on the row's connection, schema or
  table.

Modules: `features/search/`, the `signal` of a run (`execute.js`, `run.js`, `engines/pg-session.js`).
