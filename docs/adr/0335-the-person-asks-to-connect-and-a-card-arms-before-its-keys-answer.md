---
status: accepted
date: 2026-11-22
decision-makers: Team endue
---

# The person asks to connect, and a card arms before its keys answer

## Context and Problem Statement

A check of the real app after PG-01c found three faults around the Database plugin's `db:connect`
question. The completions read the schema as the person typed, and that read's `db.open` raised the
question: the card took the focus with Don't allow focused, and the next space the person typed
answered it. After that refusal the core answered every request `refused-earlier` for the rest of the
session (CORE-03), every run failed at once with "Not allowed to connect", and nothing said how to
allow it. And on macOS the terminal bound Mod+Shift+Enter desk-wide for its split, so the Database
editor's run-script key never reached the editor: the compositor gives desk-wide keys first (ADR 0118).
Who may raise the question, how does a card stop taking stray keys, and how does a person ask again?

## Decision Drivers

* The question comes from the person's own act, never from a read the plugin starts by itself
* A key typed for something else never answers a permission card, and the safe answer stays the default
* A refusal is not final for the session when the person changes their mind, yet no caller can nag
* The key a page advertises is the key that works

## Considered Options

* Reads that ask nothing until the grant exists; a 500 ms arming delay on keys; `again` on perm.request
  from the person's press; the terminal's key moved (chosen)
* Gate every quiet read in the session layer, answering its question no and holding it until the grant
* Keys never answer a card, only a pointer press
* Let a focused page keep the keys it binds, ahead of the desk-wide keymap

## Decision Outcome

Chosen option: the first, because each part fixes its fault where it starts and none needs a new
contract between pages and the compositor.

* **Who asks.** The completions read a PostgreSQL server's catalog only once the plugin holds a
  `db:connect` grant for it, which `perm.query` tells without asking (`ui/session/connect-gate.js`).
  Until then they offer the words already read. The first run, Test or Connect asks as before.
* **Arming.** For 500 ms after a card shows, no key answers it: Space, Enter and Escape are swallowed,
  a key pressed in that time stays swallowed until it is released, Tab still moves the focus. A pointer
  press, or a script's click, answers at once. The card says `data-armed` once its keys answer.
* **Asking again.** A refused run says "Allow connecting to host:port asks again", and its Messages tab
  has that button, as does Database: allow connecting. They send `perm.request` with `again: true`;
  the core then forgets the refusal for that request and asks. Only a press of the person's sends it.
* **Keys.** The terminal's macOS split-down key moves from Mod+Shift+Enter to Mod+Control+\ (Mod+Shift+\
  is the desktops overview), and a test fails when two built-in plugins bind one desk-wide key on a
  platform or one takes a chord the Database page keeps.

### Consequences

* Good, because typing never raises a question, and a refusal can be taken back from where it shows.
* Good, because the arming delay costs a pointer nothing and a hand at most half a second.
* Bad, because a caller could send `again` without the person's press and ask after every refusal; the
  core cannot tell. The card still arms, the person can refuse again, and the Permissions list shows
  the caller.
* Bad, because completions for a server not yet allowed offer only what was read before.

### Confirmation

`plugins/database/tests/connect-gate.test.ts`, `connect-refused.test.ts` and `key-clash.test.ts`,
`plugins/permissions/tests/arming.dom.test.ts` and `crates/desk-core/tests/prompt_again.rs`.

## Pros and Cons of the Options

### Gate every quiet read in the session layer

* Good, because every background read is covered, not only the completions'
* Bad, because the agents' schema reads and the value search are quiet too and would wait for ever
* Bad, because a held read keeps a session slot, and enough of them stop the person's own Test

### Keys never answer a card

* Good, because no stray key can answer
* Bad, because a card could no longer be answered from the keyboard alone

### A focused page keeps the keys it binds

* Good, because no key would need to move
* Bad, because the compositor's routing and every page would need a declaration of their keys first
