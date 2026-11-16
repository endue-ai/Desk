---
status: accepted
date: 2026-11-17
decision-makers: Team endue
---

# API Studio sends through curl, keeps collections as plain files, runs scripts in blob workers, and applies AI's changes only when asked

## Context and Problem Statement

People who build and test HTTP APIs want one window for it: requests with their params, bodies,
headers and auth; environments and secrets; scripts, checks and tests; a runner; imports from API
descriptions; and an assistant that says why a request failed. Four choices in such a client are hard
to undo once people keep their work in it: how a request leaves the desk, where requests are kept,
where scripts run, and what an assistant may change.

## Decision Drivers

* An API client sends to any host the person types; asking for each host breaks the flow of work
* Timings by phase (DNS, TCP, TLS, first byte), redirects shown hop by hop, TLS checks that can be
  turned off, any method and HTTP version: things a client is judged by
* Requests belong next to the code they test, in Git, reviewed as diffs; secrets never in those files
* The desk's plugin pages forbid `eval` and frames (`script-src` without `'unsafe-eval'`,
  `frame-src 'none'`), and allow `blob:` workers
* An assistant may propose; the person decides

## Considered Options

* The transport: `net.fetch` (a grant per host, the desk's own client), or the curl program through
  `proc.spawn`
* The store: the plugin's store, or folders of plain files
* Scripts: the page itself, a frame, or a worker from a blob
* AI: changes made as proposed, or cards applied one by one

## Decision Outcome

Chosen options: curl, folders of files, blob workers, and cards applied one by one.

* Every request is `curl -q -K -`, spawned without a shell; the whole request (URL, headers, body,
  credentials) goes on curl's standard input as its config, so nothing secret is in a process's
  arguments. stdout carries the header blocks and the body; stderr the verbose lines and curl's JSON
  report (timings, sizes, addresses, the certificate). The plugin asks for `proc:spawn` (`curl`) only.
* A collection is a folder: `collection.json`, `environments/<name>.env.json`, folders with a
  `folder.json`, one `<name>.request.json` per request; pretty JSON in a fixed key order with defaults
  left out. Secret values, OAuth tokens, cookies and the history live in the desk's store.
* A script's text is put after a prelude (a real function, turned into text) in the source of a worker
  made from a blob, so no `eval` runs; it gets ten seconds. The HTML preview is an SVG image of the
  page (`foreignObject`), which needs no frame, runs no script and loads nothing.
* The assistant's answer is a tool call whose actions are cards; each changes the studio only when the
  person presses Apply, and nothing is saved by it. Prompts carry variable names, never secret values.
  The commands that send or run (`send`, `run`) are marked irreversible, so an agent's call waits.

### Consequences

* Good, because any host works at once, and the response shows where its time went
* Good, because collections diff and merge like code, and a clone carries no secret
* Good, because scripts can change the request and set variables without loosening the desk's policy
* Bad, because a desk without curl cannot send (every desktop OS the desk runs on ships one; Settings
  names another path)
* Bad, because the cookie jar, OAuth tokens and secrets stay on one desk: a second machine sets them
  again

## More Information

`plugins/api-studio/README.md`; the transport is `ui/engine.js`, `ui/curl-config.js` and
`ui/curl-parse.js`; the files `ui/collection-fs.js`; scripts `ui/scripts.js` and
`ui/script-prelude.js`; the assistant `ui/ai-context.js` and `ui/ai-actions.js`. ADR 0088 (commands
as agents' tools).
