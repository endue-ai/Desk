# Every database of a PostgreSQL server

One PostgreSQL connection reaches every database of its server (ADR 0321). The rest of the plugin is in
[`features.md`](features.md); a change to how it moves between databases adds its line here.

- The explorer lists the databases of the connection's server its role may connect to: its own first and
  open, the others closed and read only when opened, with the same password; templates show with the
  system-schemas setting. The list comes with the schema cache's server reader, so it costs no statement.
- Each database holds its own schemas, Database and Server rows and schema cache; one that refuses says why on
  its own row and nothing else changes. Enter on a database opens a console there, named `Shop/analytics`.
- A console or table view shows its database in the header; that button and Database: switch the database
  move it to another of the server's. Pending changes are asked about first, and its session closes, asked
  first while a transaction is open (ADR 0320); the next run opens one on the new database. A console keeps
  its id and text, and comes back on its database after a restart.
- The password, the keychain's choice, history and starred queries stay the connection's; on PostgreSQL each
  history entry and starred query names the database it ran on.
- Agents' `.schema` and `.query` take an optional `database` of the server; `.schema` without a schema also
  lists the databases.

Modules: `databases.js`, `explorer-databases.js`, `explorer-table.js`, `features/databases/`, `manage.js`,
`schema-cache/`.
