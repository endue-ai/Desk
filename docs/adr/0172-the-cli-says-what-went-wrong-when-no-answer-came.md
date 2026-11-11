---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0030's `--json` ("the desk's answer line as it is") for the failures no desk answered.

# The CLI says what went wrong when no answer came

## Context and Problem Statement

The QA pass (#154, 09 #16) found the `desk` CLI quiet or wrong where no answer of the desk's could
speak for it. A wrong value (`--args 'not json'`, `--timeout 0`, `log --count 0`, `ping extra`)
printed the whole 45-line usage and not what was wrong. `desk --json ping` with no desk printed a
sentence, so a script reading stdout as JSON broke. `desk cmd run desk.start.normally` in safe mode
restarted the desk as asked, then said `lost the desk … the desk closed the connection` and exited 1:
the old desk exits before it can answer. `desk doctor --data /no/such/dir` said `ok`. `desk theme
list` called a `--dev` theme `user` while `desk theme remove` refused it as no user theme, and listed
`--dev` folders that are no plugin as failed user themes. What does the CLI say, and how does it
exit, when there is no answer line to print?

## Decision Drivers

* A person learns what was wrong from the first line, and a script from the exit code and, with
  `--json`, one JSON line on stdout
* A command that did what it was asked exits 0, even when the desk it ran on is gone
* The CLI's words about a theme match what `theme remove` does with it
* No change to the bridge or the core: the CLI is one more caller (ADR 0030)

## Considered Options

* Say it in the CLI: a sentence per usage error, a JSON line for the CLI's own failures, `cmd run`
  looking for a desk again after the connection closed
* An answer from the desk before it restarts (`cmd.answered` from `desk.start.normally`)
* Keep exit 1 for a closed connection and document that `desk.start.normally` ends that way

## Decision Outcome

Chosen option: "Say it in the CLI", because each case is the CLI's own: nothing the desk sends
covers a usage error, a missing desk or a folder that is not there, and the desk that restarts has
no moment left to answer (`desk_boot::start::relaunch` exits right after it spawns the new one).

* **Usage errors** (exit 2): `desk: <what was wrong>`, then the usage header and the lines of that
  command only (`src/usage.rs`): the value and what it should be (`--timeout takes a whole number, 1
  or more, not '0'`), the word past the longest start that is a whole command (`'extra' is not
  expected after 'desk ping'`), a flag with no value, or `'desk plugin enable' is not complete`.
  `desk` alone still prints all of it.
* **`--json` without an answer**: `{"ok":false,"error":{"code","message"}}` on stdout, the shape of
  a desk's failure line without an `id`, and nothing on stderr. Codes: `no_desk` (nothing answers at
  the socket), `io_error` (the connection failed or was lost), `timeout` (`cmd run --timeout`),
  `failed`, `unsupported`, `not_found` (`doctor --data`). `plugin validate --json` prints
  `{ ok, id, version, kind }` or `{ ok: false, problems }`.
* **A desk that closes while `cmd run` waits**: the CLI looks for a desk at the socket again,
  every 100 ms for 15 s, and takes it as back once `init.get` round-trips; a socket file gone for
  1 s means the desk quit. Back: `desk: the desk closed the connection while <id> ran and started
  again …` on stderr, exit 0. Not back: `lost the desk … while <id> ran`, exit 1.
* **`doctor --data <dir>`** that is not a folder exits 1 and says so; the desk's own data folder not
  there yet says `ok: no data folder at … yet (no desk has run as this user)`, exit 0, as before.
* **`theme list`** says where a theme comes from by its folder: `built-in`, `user` (in the user themes
  folder, what `theme remove` deletes), `pack` (`<pack>/plugins/<folder>`) or `dev`; a failed plugin
  is listed only when it is in the user themes folder.
* `export` counts every file it writes, desk.json too; `import` prints `replaced <file>` for each
  file of this HOME that held something else, and refuses a file that is neither a folder nor a zip
  archive in those words (a zip without `.zip` imports).

### Consequences

* Good, because every usage error fits on a screen and names the value, and a script with `--json`
  always gets one JSON line.
* Good, because `desk cmd run desk.start.normally` exits 0 when the desk came back normally.
* Bad, because a desk that closes the connection and crashes is reported only after the 15 s look
  (a crash leaves the socket file behind), and a desk that closed the connection without exiting
  would count as started again.
* Bad, because `pack` and `dev` are told from folder names (`plugins`, `themes`); plugin.list says
  only `builtIn` and the folder.

## More Information

Issue 09 #16 of the QA pass (#154, #163). Amends ADR 0030. Code: `crates/desk-cli/src/usage.rs`,
`src/args.rs`, `src/args/forms.rs`, `src/remote.rs`, `src/remote/cmd.rs`, `src/remote/gone.rs`,
`src/health.rs`, `src/theme.rs`, `src/export.rs`. Tests: `crates/desk-cli/tests/usage.rs`,
`no_answer.rs`, `health.rs`, `theme.rs`, `export_import.rs`, `validate.rs`. No section of
`docs/ko/desk-structure.md` changes.
