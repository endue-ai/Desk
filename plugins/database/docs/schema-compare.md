# The Database plugin's schema comparison

Two PostgreSQL schemas compared object by object, and the migration script between them written for the
direction and the objects chosen (PG-53, ADR 0338). The rest of the plugin is in [`features.md`](features.md);
a change to the schema comparison adds its line here.

## Comparing

- Database: compare two schemas takes any two of: a schema on a connection, a schema on another connection
  (or another database of the same server, `<name>/<database>`), a folder of DDL files, and a saved snapshot.
  The palette asks for what a command leaves out. On MySQL and SQLite it is refused in words.
- The panel lists what exists only on the left, only on the right, and what differs, grouped, each object with
  its DDL on both sides. Up to 1,000 of a group are listed; the counts stay exact.
- Objects compared: tables (columns, primary key, unique and check constraints, foreign keys, indexes,
  comments, partition key), views, materialized views, sequences, functions and procedures, enum, domain and
  composite types, and triggers. Owners, privileges, statistics, tablespaces and extensions are not compared,
  nor are an extension's own objects.
- Not differences: whitespace, case of keywords and unquoted names, comments, needless quoting, one pair of
  outer parentheses, the order of columns, constraints, indexes and objects, the schema's own name, and the
  names PostgreSQL generates for constraints and indexes. A named constraint renamed is a difference.
- Reading runs one catalog statement per kind with the progress between them; Cancel (`Escape`) stops it and
  nothing is compared. Past 2,000 objects the comparison runs in a worker; below, in place.
- A folder reads every `.sql` file three folders deep. A statement it cannot read is listed as a note, and a
  table it cannot parse is held: the script does not change it.

## The script

- It makes the target like the source: Swap direction writes the other one. Each object has a box; the script
  holds only the chosen ones.
- In the order of what each object names: views and triggers that go or are rebuilt are dropped first, then
  types, sequences, functions, tables, views, materialized views and triggers are created or changed, the
  foreign keys of new tables after every new table, and what goes is dropped last, in reverse order.
- A changed table is altered with the table form's writer (PG-51): columns matched by name, constraints and
  indexes by what they hold. A column renamed shows as one dropped and one added; write a rename in a console.
- A changed view or function is CREATE OR REPLACE (marked: it fails when the columns or result type change); a
  changed materialized view is dropped and created again; an enum gains values with ADD VALUE.
- Destructive steps carry their words as `-- ` lines. What the script will not write is said at its top, and
  Run waits: an enum value removed, a domain or composite type changed, a type change with no cast, a table
  that did not read.

## Running it

- The script never runs by itself. Run and Dry run send it in one transaction through the plugin's guards: a
  read-only target is refused, production asks with its tag, a drop is asked as dangerous. After a run the two
  sides are compared again. Open in console puts the script in a console of its own, to finish or keep; a
  folder or snapshot target has only that.
- Agents compare, dump and save; only the person runs a script.

## Files

- Database: dump a schema to a folder writes one file per object, `<kind>/<name>.sql`, in a stable order and
  format, for version control. `.sql` files no object holds any more in those folders go to the trash.
- Database: save a schema snapshot writes one versioned JSON file where the save dialog says, to compare
  against later. Both formats: ADR 0338.

Modules: `features/compare-schema/`.
