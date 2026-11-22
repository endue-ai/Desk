---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# PL/pgSQL bodies are checked by PostgreSQL's own PL/pgSQL grammar, and drawn from the plugin's lexer

## Context and Problem Statement

PG-35 (#465) asks that a routine be edited in a PostgreSQL console with the same help as a query: inside
the dollar quotes of `CREATE FUNCTION`, `CREATE PROCEDURE` with `LANGUAGE plpgsql` and of `DO`, keywords,
variables and parameters highlighted and blocks folded; completion of declared variables, parameters,
`%ROWTYPE` fields and the schema's names in the SQL inside; and problems: a variable used and never
declared, one declared and never used, code after RETURN, and syntax errors with their line. Until now a
body was one string to the lexer. Which grammar tells a body's syntax, how is a position found when that
grammar gives none, and what draws and completes a body that is still being typed?

## Decision Drivers

* A syntax problem says what the server says when the routine is created, on the same line
* Nothing is told where the server would accept the routine
* Highlighting, folding and completion work on half-typed bodies and stay inside the editor's budgets
* No new dependency: the vendored parser (ADR 0283) and the plugin's lexer only

## Considered Options

* PL/pgSQL's own grammar (the vendored parser's `parse_plpgsql`) for problems; the plugin's lexer and an
  outline of the body's blocks and declarations for drawing, folding and completion
* A PL/pgSQL grammar of the plugin's own, for all four
* Ask the server: create the routine in a transaction rolled back, on every pause in typing

## Decision Outcome

Chosen option: "PL/pgSQL's own grammar for problems, the plugin's lexer for the rest", because the
grammar is the server's own (pl_gram.y, which also reads every SQL statement and expression inside with
the server's SQL grammar), so its messages are the server's to the letter, and it costs no request.

- The parse worker sends a routine's statement to `parse_plpgsql` after the statement parsed as SQL. Its
  message comes without a position, so the body is cut after each `;` with its open blocks closed (END,
  END IF, END LOOP, END CASE, BEGIN END for a DECLARE without its BEGIN) and parsed again; the first cut
  that fails with the same message holds the error (a binary search, a dozen parses for a long body). The
  problem is the last token of the name the message quotes in that statement, or its `;` when an
  expression ended early ("at end of input"), and the message adds its line of the body.
- A body that parses is checked over PL/pgSQL's tree: an expression the grammar left for run time (an
  IF's, a RETURN's, an assignment's, a SELECT with no FROM) is parsed as SQL and its bare names that no
  datum, parameter, declaration or label names are told in the server's run-time words; unused variables
  and statements after a list's RETURN, RAISE EXCEPTION or unconditional EXIT and CONTINUE are warnings
  (`unused-variable`, `unreachable-code`, ADR 0328's settings and ignore comments).
- Drawing, folding and completion read the body with the plugin's lexer (its scanner is PostgreSQL's own
  SQL scanner's rules) and an outline of blocks and declarations that tolerates what is half typed.
  Completion turns the PL/pgSQL statement at the caret into the SQL it runs as and hands it to PG-31's
  completion (ADR 0327), with the variables in reach added.

### Consequences

* Good, because a syntax problem is the server's message and the live test holds it to the server's line.
* Good, because no request is made while typing and nothing is created on the server.
* Bad, because the cut-and-parse search can name a statement the closing words made fail; it then still
  marks a token of the server's message, in a statement near it.
* Bad, because scope is the routine's: a name declared in any block counts as declared everywhere.
* Neutral, because a single-quoted body (never what the server writes back) stays plain text.

### Confirmation

`plugins/database/tests/plpgsql-*.test.ts`; `plpgsql-live.test.ts` creates and calls a corpus on a real
PostgreSQL and compares each problem's message and line with the server's; `just test-e2e
e2e/database-plpgsql.spec.ts`.

## Pros and Cons of the Options

### A PL/pgSQL grammar of the plugin's own

* Good, because it could give positions and scopes directly.
* Bad, because it would be a second grammar to keep in step with the server's, and its messages would not
  be the server's.

### Ask the server

* Good, because it is the server's answer, position included.
* Bad, because it sends every pause in typing to the server, needs a session and a role that may create
  routines, and runs the validator's side effects; the plugin never queries the catalog to check (ADR 0294).
