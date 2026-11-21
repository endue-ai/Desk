---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Format SQL lays PostgreSQL out from its parse tree, and keeps a statement as written unless its tree is the same

## Context and Problem Statement

Format SQL in `endue.database` (`ui/editor/format.js`) reads tokens alone: it starts a line at a
reserved word wherever it stands, so it cannot tell BETWEEN's AND from a condition's, a keyword used
as a column name from the keyword, or a subquery from a list in brackets, and it has no style. PG-34
(#464) asks for a layout by PostgreSQL's grammar with a style the person sets (keyword case, indent,
comma position, line width, AND/OR placement, joins, what stays on one line), that changes nothing
but space and the case of keywords, keeps comments, and leaves a statement that does not parse as it
is. The plugin already has the server's grammar in a worker (ADR 0283). How is the new text made, how
do we know it says the same thing, and where does it run?

## Decision Drivers

* Only whitespace and the case of keywords change; a statement never means something else
* Every comment stays, next to the token it was written by
* The grammar decides what a word is: a keyword, a name spelled like one, a type, an operator
* Never on the frame's main thread: a large console must not hold up typing (ADR 0283's budget)
* A style of a few settings with common PostgreSQL defaults, followed while the plugin runs

## Considered Options

* The scanner's tokens laid out by the parse tree's structure, then parsed again: the statement is
  kept as written unless the new text gives the same tree
* The tree printed back to SQL by the parser's deparser
* The token formatter of today, made smarter
* A JavaScript SQL formatter for many dialects, vendored
* Where it runs: the parse worker, a worker of its own, the page

## Decision Outcome

Chosen option: "the scanner's tokens laid out by the parse tree, then parsed again, in the parse
worker", because it writes back exactly the tokens the person typed, comments included, takes every
decision about what a word is from the server's own scanner and tree, and proves each statement by
the same parser before a character of the console changes.

* `ui/sql/layout/`: `tokens.js` reads a statement with the vendored build's scanner (`wasm_scan`,
  added to `wasm.js`), with each comment attached to the token before it on its line or to the next;
  `roles.js` reads the tree for the keywords it takes as names (a column, relation, function, role or
  option spelled like a keyword keeps its spelling), the keywords of a type (written in lower case, as
  PostgreSQL's documentation writes them, unless the keyword case is preserve) and the operators
  between two operands; `clauses.js` finds a query's clauses where the grammar starts them; `build.js`
  makes a document of groups, breaks and indents by the style, and `doc.js` prints it at the width.
* `layout.js` parses the new text of each statement again and compares the two trees with their
  places (`location`, `stmt_len`, `*_list_start` ...) left out; a statement whose tree differs keeps
  its own text and is counted as refused. A statement that does not parse is left as written with the
  server's message and line; so is a routine with a BEGIN ATOMIC body (PG-35 lays those out). Between
  statements: a statement a line, one blank line apart, and a gap with a comment as it was.
* The style is eight settings `endue.database.format-*` with choices and ranges in `plugin.json`:
  keyword case upper, indent 4, line width 80, comma last, AND and OR before, joins flat, one line per
  clause when it fits, lists indented under their clause. The console reads them at each Format, so a
  change applies without a restart. The desk's settings page has no room for a plugin's preview, so
  Database: preview the SQL format opens a panel (`features/format/`) with a sample laid out by the
  style in force, laid out again when a setting changes.
* It runs in the parse worker (`{ type: "layout" }`, `SqlParser.layout`): the page sends the text and
  the style and gets back the range to replace, its new text, and what was left as written, which the
  status line says. 1 MB of the corpus lays out in under a second there.
* Database: format the SQL keeps its reach (the selection, else the console) and `Mod+Shift+F`; Database:
  format the statement at the caret is new. MySQL and SQLite keep `format.js`.
* Format on save is a ninth setting, `endue.database.format-on-save`, off by default: Save lays a bound
  `.sql` file's console out by the format of the file's connection before it writes the file. A file on
  no connection yet is written as typed, since nothing says which grammar it is in.

### Consequences

* Good, because over the parser's corpus, the SQL the plugin writes and five styles, the scanner reads
  the same tokens back but for keyword case, the trees are the same, nothing is refused and a second
  Format changes nothing (`layout-corpus.test.ts`); the server's own parse tree (`debug_print_parse`)
  is the same for 61 statements in two styles (`layout-live.test.ts`).
* Good, because a gap in the layout costs only looks: the check keeps the statement as it was.
* Bad, because every statement is parsed twice and scanned once more; still well inside the worker's
  budget.
* Bad, because the layout knows the clauses of queries and lists of DDL, not every statement's own
  shape: a rare statement is wrapped at the width rather than laid out by its parts.
* Bad, because a type's keywords are written in lower case under the upper style, a choice not every
  team makes; preserve keeps them as typed.

The deparser was rejected because it drops comments and writes the server's spelling (`int4`,
`::text` casts, quotes, parentheses), changing far more than space. The token formatter cannot know
what the grammar knows. A many-dialect formatter is not PostgreSQL's grammar and could change meaning
silently. A worker of its own would load the parser twice; the page must not lay out a large console.

## More Information

ADR 0283 (the parser and its worker), ADR 0286 (a `.sql` file bound to a console, PG-24 #457), issue
#464 (PG-34), epic #438. PG-35 (#465) lays out the bodies of routines.
