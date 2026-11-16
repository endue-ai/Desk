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
* A collection can come from anyone (a clone, a download, a HAR recording), and curl reads files and
  speaks protocols past the desk's own grants

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

### What a collection, a server or an agent cannot make a request do

curl runs as the person, so the studio, not the desk's grants, decides what it may reach:

* curl speaks only HTTP and HTTPS (`proto` and `proto-redir` `=http,https` in every config), and a
  URL with another scheme is refused before curl starts: a `file://` URL would read this computer's
  files into a response. A header's name keeps only token characters, so it never reaches curl's
  `@file` form.
* A body file (a file body, a multipart file part) goes out without asking only when the person chose
  it in this session or it lies inside the request's collection folder as a plain path (no `.` or
  `..`, which curl resolves through symlinks) with no symlink on the way (`fs.stat` on each step);
  any other path asks first, once per path for the session.
* A script runs only when the person wrote it here or allowed it. The studio keeps the SHA-256 of
  every allowed script in the desk's store and checks each script a send would run by its text,
  wherever the tab came from (a collection, the history, a copy), so a script that arrives or
  changes on disk (a pull) is asked about again. A script the person types in its own editor is
  theirs and stays allowed (only that one: typing a Before script allows no After script), and so
  are tests the assistant adds when the tests they join were theirs or allowed. "Stop running its scripts" in the collection's menu takes a
  collection's allowance back.
* A secret typed as it is into what a request's, folder's or collection's file keeps (the auth's
  passwords, tokens and keys when the auth is written, a password in the URL, secret headers, query
  pairs, fields of the body in use, variables) is found before the file is written, and the person
  is offered to move it into a secret variable of that collection's environment in use (or of a new
  `Local secrets` one made for them, never one of that name from the files), leaving `{{name}}` in
  the file; a JSON value is rewritten alone, the rest of the body as typed. Never into the globals, which fill into every
  collection's requests. A HAR import puts the recording's session (Authorization, Cookie, tokens,
  a password in the URL, secret form fields) into secrets of a `Recorded` environment. The history
  keeps no typed secret.
* curl sends custom headers to another host when it follows a redirect (only Authorization and Cookie
  are dropped), so a request carrying a secret (a header by its name or by a secret's value, curl's
  credentials, a secret in the query or the body) does not let curl follow: the studio follows each
  hop, and on every hop to another origin drops the secret headers (the jar's cookies for the origin
  left among them), the credentials and the secrets in the query, taking the jar's cookies for the
  new origin only when the request uses the jar. A hop to another origin that would send the body
  again (a 307 or 308, or a 301 or 302 of anything but a POST) is not taken when the body holds a
  secret, a secret's value or a typed password alike.
* A request an agent writes itself (`send` with a url) fills in no secret variable, no variable whose
  name says secret, no value set while running (a capture may be a token under any name) and no
  cookie from the jar; it names any host. A saved request sent by name is the person's and gets its
  environment.
* What an assistant or an agent reads (the prompt, the commands' answers) has secret headers, query
  pairs and JSON fields hidden, every secret's value wherever it turns up (as typed or as a URL or
  form carries it; the last send's credentials too), the `Location` header's secret query pairs, and
  failures of checks and tests on a secret. A name is secret when it says so in any spelling
  (`Private-Token`, `x-api-key`, `access_token`, `clientSecret`), not when it only pages or names a
  token (`page_token`, `tokenUrl`, `Idempotency-Key`); generated code hides the same, and its string
  literals cannot run what a value holds (Kotlin's `$`, PowerShell's typographic quotes, a method in
  a shell command).
* A request that does not check the server's certificate says so beside its URL, wherever the
  setting came from.

The desk's store, where secrets, tokens and cookies live, is a plain JSON file in the desk's data
folder, as connector secrets are until the desk keeps them in the OS keychain (ADR 0036, ADR 0239).

### Consequences

* Good, because any host works at once, and the response shows where its time went
* Good, because collections diff and merge like code, and a clone carries no secret
* Good, because scripts can change the request and set variables without loosening the desk's policy
* Bad, because a desk without curl cannot send (every desktop OS the desk runs on ships one; Settings
  names another path)
* Bad, because the cookie jar, OAuth tokens and secrets stay on one desk: a second machine sets them
  again
* Bad, because a shared collection's scripts wait for a yes on each desk, and again after each change
  that arrives on disk; a copy or a history entry of a request whose scripts were never allowed asks
  too
* Bad, because a request with a secret follows its redirects one curl at a time, a little slower

## More Information

`plugins/api-studio/README.md`; the transport is `ui/engine.js`, `ui/curl-config.js` and
`ui/curl-parse.js`; the files `ui/collection-fs.js`; scripts `ui/scripts.js` and
`ui/script-prelude.js`; the assistant `ui/ai-context.js` and `ui/ai-actions.js`; the guards
`ui/guards.js`, `ui/trust.js`, `ui/file-guard.js`, `ui/literal-secrets.js`, `ui/redirects.js` and
`ui/secret-names.js` (tested in `tests/security.test.ts`, `tests/redirects.test.ts`,
`tests/literals.test.ts`, `tests/trust.dom.test.ts` and `tests/studio.dom.test.ts`). ADR 0088
(commands as agents' tools).
