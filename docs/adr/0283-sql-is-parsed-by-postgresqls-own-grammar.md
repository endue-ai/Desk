---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# The database plugin parses SQL with PostgreSQL's own grammar, in a worker of its own

## Context and Problem Statement

`endue.database` knows a script as tokens (`ui/sql/lexer.js`), statements (`ui/sql/split.js`) and a
first word (`ui/sql/classify.js`). Completion, checks, rename and the other features of the
PostgreSQL client plan (#438, PG-30 to PG-36) need the structure of each statement: which
relations, columns, aliases, CTEs and functions it names, and where. The plugin is a folder that
runs as it is (ADR 0012), in a sandboxed frame whose CSP allows `'wasm-unsafe-eval'` and workers
from blobs (ADR 0048), and no network. Which parser, and where does it run?

## Decision Drivers

* Every statement kind of the supported servers (13 to 18), parsed as the server parses it
* The server's message and position for a statement that does not parse
* Never on the frame's main thread: a large script must not hold up typing or drawing
* A plugin folder that runs as it is: no build step, a copy pinned and reproducible, licences next to it

## Considered Options

* libpg_query, the BSD-licensed C library that extracts the server's parser, in the WebAssembly
  build the npm package `libpg-query` 18.2.4 ships, vendored from its registry tarball
* The same package through `package.json`, the lockfile and a bundler
* One build per server major (13 to 17) next to the 18 one, or a package that holds them all
* libpg_query built to WebAssembly by us, from source, in a pinned toolchain image
* A grammar of our own in JavaScript, or a JavaScript SQL parser for many dialects
* Asking the server: PREPARE or EXPLAIN on the connection, the answer as the check
* Where it runs: a worker of its own, the result worker (`ui/output-worker.js`), or the core

## Decision Outcome

Chosen option: "libpg_query's prebuilt WebAssembly build, vendored, in a worker of its own",
because it is the server's grammar, it runs in a module worker without Node's APIs once its glue
is an ES module, and it reads 1 MB of SQL in about a tenth of a second.

* `scripts/vendor-libpg-query.mjs` downloads the tarball, refuses it unless its SHA-256 is
  `4dcb2660…c785` and its `package.json` names the libpg_query commit it pins, and copies
  `wasm/libpg-query.wasm`, the glue as `libpg-query.mjs` (its CommonJS export made
  `export default`, its Node test made `false`) and the package's MIT `LICENSE` into
  `plugins/database/ui/vendor/`, with libpg_query's BSD-3-Clause `LICENSE` and PostgreSQL's
  `COPYRIGHT` from that commit, each pinned by hash. `VERSIONS` records every file's hash, and
  `scripts/vendor-libpg-query.test.mjs` holds the committed copy to it without the network. No
  `package.json` or lockfile change. The parser is 1.72 MB of wasm and 62 KB of glue on disk.
* One grammar, PostgreSQL 18's, for every server: syntax newer than the server parses, and the
  server stays the judge when the statement runs. Per-version builds cost 1.7 MB each for
  differences that are mostly additions.
* `ui/sql/parse/worker.js` loads the parser, fetching the wasm next to itself and compiling it
  once; `ui/sql/parse/client.js` is the page's side, handed `startWorker` by `ui/main.js`.
  `scripts/plugin-workers.mjs` lists every parser module and the vendored build as loaded by that
  worker only. A parser that traps (deep nesting) is started again for the next request.
* `parse` answers every statement's raw parse tree (libpg_query's JSON), its kind, start and end,
  or the server's message and position. A script that does not parse whole is cut by the plugin's
  splitter (psql's rules) and each statement parsed alone; over the plugin's own scripts the two cut
  every statement at the same place (`tests/split-parse.test.ts`). Locations are UTF-8 bytes of the
  whole script; positions also carry the editor's offset, line and column.
* The resolver binds names to the schema model the explorer's catalog reads, as the server would:
  `search_path` with `pg_catalog` first and `$user`, CTEs, query levels, LATERAL, JOIN USING, output
  names, the targets of DML, `excluded`, RETURNING's `old` and `new`. A name that binds to nothing is
  `missing`, `ambiguous`, or `unread` when the model does not hold where it could be. Routine bodies
  in quotes stay strings.
* Budget, in the worker, for 1 MB of SQL (8,600 statements): a parse within 1 s, a resolve within
  2 s (`tests/parse-worker.test.ts`, the fastest of three runs). Measured on a development laptop
  in a Node 26 worker thread: parse 95 to 135 ms, resolve 265 to 290 ms (73,000 names); with one
  statement that does not parse, 215 and 375 ms. Answering the trees to the page adds about 130 ms
  of copying, so `outline` and `resolve` leave them in the worker and `parse` answers them.

### Consequences

* Good, because every statement kind, error message and position is the server's own, and a new
  server release is a new pin.
* Good, because the parser never shares a thread with the frame or with reading results.
* Bad, because 1.78 MB of third-party build is in the repository, updated by hand, and the build is
  only as maintained as the package that publishes it.
* Bad, because the tree is the raw parse tree: names are bound by our resolver, not the server's
  analyser, so a rule it does not follow (a function's overloads by argument type) stays open.
* Bad, because parameters that are not PostgreSQL's (`:name`, `?`) do not parse until a caller
  fills them in.

The other options: a bundled npm dependency needs a build step plugins do not have; our own
Emscripten build adds a C toolchain to CI for the same bytes; a JavaScript grammar is never the
server's and drifts every release; the server answers only with a connection, one round trip per
edit, and no tree. The result worker would make a long parse hold up results, and the core would
put a native library and a bridge API under one plugin.

## More Information

#445 (PG-05) in #438. ADR 0012 (plugins run from their folder), ADR 0043 (vendoring from a pinned
tarball), ADR 0048 (plugin workers). `plugins/database/ui/sql/parse/`, `docs/qa/TESTING.md`.
