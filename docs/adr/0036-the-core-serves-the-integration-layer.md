---
status: proposed
date: 2026-10-31
decision-makers: Team endue
---

# The core serves the integration layer, with the OS calendar built in and secrets in a file until the keychain

## Context and Problem Statement

ADR 0032 made connected data items, views and connectors; ADR 0033 put the items in `desk-index`;
ADR 0034 runs Wasm connectors in `desk-plugin-host`. Issue #98 wires them into `desk-core` behind
`data.*`, `connector.*`, `view.*` and `catalog.get` (DM-02, DM-03, DM-05, CN-02, CN-04, CN-05,
CN-06, CN-09, VW-01, PRV-01, PRV-05). What lives where on disk, where the OS calendar's connectors
live, where secret settings go before Desk talks to the keychain, and how the crates meet are all
in every desk's data folder and every connector built against them.

## Decision Drivers

* Everything a person connects stays on the device and goes with one disconnect (PRV-01, PRV-05)
* Desk is useful on the first day with no account: the OS calendar and reminders (CN-06)
* desk-core stays a kernel that knows separate crates by their seams (PKG-01); the app stays a thin
  adapter
* No `unsafe` outside desk-sys, no OS prompt from a test, no prompt the person did not ask for

## Considered Options

* Built-in connectors in desk-core; or as plugin folders (a `wasm` connector cannot reach EventKit)
* Secrets in a 0600 file now; the OS keychain now (desk-sys has no keychain yet); refusing secret
  settings until it has one
* desk-core depending on desk-index and desk-plugin-host; or a core-side trait over the connector
  host with a glue crate, wired in the app

## Decision Outcome

Chosen options: "built-ins in desk-core", "a 0600 file now", "desk-core depends on both crates",
because each is the smallest step that serves the bridge today and each can be replaced behind the
same methods later.

* **Files.** The index is `<data folder>/index.sqlite` beside `grants.json` (ADR 0029, 0033);
  connector secrets are `<data folder>/secrets.json`; the person's views are
  `~/.desk/views/<id>.yaml`, a file named after its id, read on every call and watched both ways.
  Instance records stay in each connector's store under `desk.connector/instances` (the host's
  shape, reused by the built-ins) and their titles under `desk.connector/titles`.
* **Built-in connectors.** `desk.calendar` (`event`) and `desk.reminders` (`task`) are defined in
  desk-core over desk-sys's `CalendarSource`, exist only with one (`Core::with_calendar`; macOS
  today), have `auth: none`, no settings and one instance `default`, and are never turned off.
  The OS is asked only by `connector.connect`. An event's item id is the EventKit id, or
  `<id>@<start>` for an occurrence of a repeating event; `raw` keeps `calendarId` and `eventId`.
  desk-sys gives no modification time, so `updatedAt` is the sync's time for a new or changed item,
  and an unchanged one is not written again. They sync every 900 s over [now - 30 days,
  now + 180 days) and reminders open or done in the last 30 days.
* **Secrets** until desk-sys has a keychain: `{ version: 1, note, secrets: { "<connector>/<instance>":
  { "<setting>": "<value>" } } }`, written whole through a temp file created 0600 on Unix (the
  profile folder's ACL on Windows), never listed, never handed to a guest, removed on disconnect.
* **Crates.** desk-core depends on desk-index and desk-plugin-host, holds the index as
  `Arc<dyn ItemIndex>` and one `ConnectorHost`, and is the host's `Host` and `IndexSink` through an
  adapter that holds the core weakly. Each import is `Core::handle` as the plugin with the narrowest
  scope, so the person's grants decide; the core never holds its own lock across a host call.

### Consequences

* Good, because disconnecting an instance clears its items, record, title and secrets in one call,
  and every file a person may want gone is in the data folder or `~/.desk/views`.
* Good, because a Mac with no account gets calendar and reminders items on the first connect.
* Good, because the bridge, not the app, decides every call: the app only opens files and starts
  threads.
* Bad, because secrets are plain text on disk, readable by any process of the same OS account,
  until the keychain lands; the move must migrate the file and delete it.
* Bad, because `updatedAt` of a built-in item is when Desk noticed, not when the person changed it,
  and every sync reads the whole window to compare.
* Bad, because desk-core now builds Wasmtime and SQLite into every crate that uses it (the CLI).
* Bad, because comments in a hand-written view file are lost when Desk saves over it.

## More Information

Issue #98. Code: `crates/desk-core/src/{core_data,core_connectors,core_builtins,core_wasm,core_host,
core_views,core_catalog,calendar_items,secrets}.rs`, `apps/desk/src-tauri`. ADR 0029 (grants on
disk), ADR 0032 (items, views, connectors), ADR 0033 (the index), ADR 0034 (Wasm connectors). The
architecture documents get the integration layer's line in a docs task after this one.
