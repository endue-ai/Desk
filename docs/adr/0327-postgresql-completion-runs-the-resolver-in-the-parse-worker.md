---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# PostgreSQL completion runs the resolver in the parse worker

## Context and Problem Statement

PG-31 (#461) asks that the console's completion know the statement: after JOIN the tables a foreign key
links with their ON condition, INSERT's column list and VALUES row, `*` written out, the columns of CTEs,
subqueries and set-returning functions, correlated levels, comments, quoting, signature help, snippets and a
ranking that learns from the person's picks. The old completion read FROM items from the page's tokens and
the catalog. The plugin already has PostgreSQL's grammar in the parse worker (ADR 0283), a resolver that
binds every name of a statement with its scope (PG-05), the schema cache's model (ADR 0285) and, per console,
what the script's statements did to the ones after them (the problems check, ADR 0294). Where does
completion work out what is in scope, and how does a statement that does not parse yet still complete,
inside a frame on a 1 MB script?

## Decision Drivers

* One answer to "what does this name stand for": completion and the problems check never disagree
* Nothing asked of the server while typing
* The frame's thread never parses: a completion costs the statement at the caret, not the script
* A half-written statement (the usual case while completing) still completes
* MySQL and SQLite keep completing without a grammar

## Considered Options

* The resolver in the parse worker, over the statement with a placeholder at the caret
* Extend the page's token reading to CTEs, subqueries and functions
* Parse on the page with the vendored grammar

## Decision Outcome

Chosen option: "the resolver in the parse worker", because it is the same binder the problems check uses,
over the same model and the same per-console state, and it already knows CTEs, subqueries, lateral and
set-returning functions, joins and correlated levels. Token reading would be a second binder that drifts
from the first; parsing on the page would run the grammar on the frame's thread.

* The page sends the statement around the caret (as before), the caret in it, where it starts in the
  console, the person's picks and the snippets in force (`complete` in `sql/parse/worker.js`).
* The worker replays what the console's last check recorded for the statements that end before the
  statement (`stateAt` in `diagnose/check.js`: search path, role, created relations), without parsing them.
* The word being typed becomes a placeholder name; the statement is parsed. When it does not parse, its
  tail is cut back from the error token by token, open parentheses are closed, and after JOIN an `on true`
  is tried, at most 16 parses. The resolver is run with a probe: the ColumnRef or RangeVar that starts at
  the placeholder records the scope it was bound in (and, in FROM, the items before it). That scope's
  levels, CTEs and items are what completion offers (`editor/statement.js`). When nothing parses or the
  probe meets nothing, the FROM items read from the tokens answer, as on the page.
* Candidates are made by the same pure `editor/complete.js` on both sides (joins, lists, `*`, columns,
  names, functions, types, keywords and snippets) and ordered by `editor/rank.js`: match, scope, the type a
  slot expects, picks, name. MySQL, SQLite and a PostgreSQL connection whose cache lists nothing yet complete
  on the page over the catalog, without a scope hook.
* The model gains what completion shows: column comments and whether a column has a default, foreign keys,
  relation and routine comments, and types. The resolver reads only names and types, so the check is unchanged.
* Picks are counts and times by candidate key in the plugin's store under one key (`completion-picks`), 200
  at most; signature help is the same request with `want: "signature"`.

### Consequences

* Good, because a name completion offers is a name the problems check binds, under the same search path and
  the same script state
* Good, because a completion on a 1 MB script parses one statement: about 4 ms in the worker, measured
  across a real worker thread too
* Good, because CTEs, subqueries, lateral items and set-returning functions complete with no code of their own
* Bad, because a statement whose damage is before the caret may not mend, and then only the FROM items the
  tokens show are offered
* Bad, because the cache does not say which columns are identity columns, so INSERT's "without a default"
  list keeps them
* Bad, because a console that was never checked starts from the server's default path, not the session's

### Confirmation

`plugins/database/tests/complete-statement.test.ts` (joins, lists, `*`, scope, quoting, ranking, comments,
script state), `complete-signatures.test.ts`, `complete-snippets.test.ts`, `complete-rank.test.ts`,
`complete-editor.test.ts` (snippets, ranges, picks, signature help on jsdom), `complete-feature.test.ts`
(the plugin mounted, nothing sent to the server), `complete-budget.test.ts` (1 MB in the worker and across a
worker thread), `complete-live.test.ts` (what completion writes run by a real server), and
`packages/runtime/e2e/database-complete.spec.ts` in the page.

## More Information

`plugins/database/ui/editor/` (`statement.js`, `model-view.js`, `complete.js`, `caret.js`, `rank.js`,
`joins.js`, `lists.js`, `snippets.js`, `signatures.js`, `builtins.js`, `completion.js`, `signature-help.js`),
`ui/features/completion/`, `ui/diagnose/check.js` (`stateAt`), `ui/sql/parse/` (the probe). The resolver is
PG-05's; the model ADR 0294's; the worker ADR 0283's.
