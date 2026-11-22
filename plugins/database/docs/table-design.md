# The Database plugin's table form

A PostgreSQL table created, or an existing one changed, by editing its design, with the exact script shown
before anything runs (PG-51, ADR 0324). The rest of the plugin is in [`features.md`](features.md); a change to
the table form adds its line here.

## Opening it

- New table… on a schema's row menu, Change the table's design… first on a table's (`o`, a right click), or
  Database: create a table and Database: change a table's design (the palette asks the connection, the schema
  and the table). One form per connection and table, a panel of its own; opened again, it is as it was left.
- On MySQL and SQLite the form is refused in words: the CREATE or ALTER is written in a console there.
- It reads the server once when it opens and on Read again: its version, its types (built-in, enums, domains,
  composites), its implicit and assignment casts, its roles and index methods, and the table's columns,
  constraints and indexes as the catalog has them. The schema cache serves the foreign key pickers.

## The design

- Columns: name, a type of the server's (a list to pick from, a length, an array), NOT NULL, the primary key,
  a default, an identity (ALWAYS or BY DEFAULT) or a stored generation, and a comment. A new table's columns
  move up and down; an existing table's keep their order, which the form says (PostgreSQL adds a column at the
  end and cannot move one). An existing column dropped stays listed, struck through, with Keep.
- Keys: the primary key, unique and check constraints; Foreign keys: the columns, the referenced schema, table
  (or this table) and columns, ON DELETE and ON UPDATE; Indexes: the method, its columns or expressions,
  unique, a WHERE for a partial one, and CONCURRENTLY; Table: the comment, the owner, and for a new table its
  partitioning (RANGE, LIST or HASH and the partition key).
- A constraint or index the form cannot draw (an exclusion constraint, an index with an opclass, NOT VALID,
  deferrable) shows its definition, kept: it can be renamed or removed, not edited. An empty name lets the
  server name a new part.

## The script

- It grows as the form is edited, between BEGIN and COMMIT, every identifier quoted, in an order that applies:
  the table renamed, indexes and constraints that go or change dropped, columns dropped, columns and parts
  renamed (a chain of renames in an order that applies), each column's changes (every type change in one
  ALTER TABLE, so the table is rewritten once), new columns, new constraints and indexes, comments, the owner.
- A rename is a rename (columns, the table, constraints, indexes), never a drop and an add: parts are matched
  by what the server knows them by, not by their names.
- The dangerous steps carry their words as `-- ` lines: a rewrite of the whole table, a lock that blocks
  writes or reads, a dropped column, a type change that can fail, NOT NULL or a new constraint that reads
  every row, a NOT NULL column added with no default, a volatile default, an identity's sequence.
- What the form will not write safely is said instead, and Run waits: a type change with no automatic cast
  (it needs USING: the script opens in a console to finish it), names that take each other's in a cycle, a
  column made generated, a generation changed before PostgreSQL 17, a part that holds a dropped column, and
  every problem of a field (an unknown type, a length the type does not take, an expression that is not one).

## Running it

- Run (`Mod+Enter`) sends the steps in one transaction; a failing step rolls all of it back and is marked,
  with the server's words. A CONCURRENTLY index runs after COMMIT, on its own, which the script says.
- Dry run sends the steps and rolls back, and leaves the CONCURRENTLY indexes out. Open in console puts the
  script in a console of its own, to finish or keep.
- The guards of the objects' operations (ADR 0312): a read-only connection opens the form to read and has no
  Run; production asks with its tag, and a dropped column is asked as dangerous. Agents fill the form with
  create-table and change-table; only the person runs it. After a run the explorer reads what changed, and
  the form reads the table again (a new table opens its own form).

Modules: `features/table-design/`.
