---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

# proc.write can close stdin, so a program that reads its input to the end can run

## Context and Problem Statement

The Git plugin stages a hunk or chosen lines by handing git a patch (#314). `git apply` reads a patch
from a file or from stdin to its end. Bridge v0's `proc.write` wrote to stdin but could never close it:
the core closed the pipe only when the process went away, so `git apply --cached -` waited forever, and
the plugin answered "stage the whole file" instead.

## Decision Drivers

* The patch should reach git without a shell and without a new permission for the plugin.
* Bridge v0 callers must keep working unchanged.
* No temp files beside a repository, and no versions in the desk's local history for them.

## Considered Options

* `proc.write` gains an optional `close: true` that closes stdin after its data.
* The plugin gets an `fs:write` grant wide enough for any repository, writes `.git/<n>.patch` with
  `fs.write`, runs `git apply --cached <file>` and moves the file to the trash.
* A new method, `proc.close`.

## Decision Outcome

Chosen option: "`close: true` on `proc.write`", because it is one optional field on a call that already
carries the scope, the data and the close go in one round trip, and nothing else changes for the
plugin: its `proc:spawn` grant for `git` already covers it. The person chose it on the issue.

`data` may be empty. A later write is `io_error`; closing twice does nothing more. A process in a PTY has
no stdin apart from its terminal and answers `unsupported` before a byte is written.

### Consequences

* Good, because any plugin can now drive a program that reads to the end of its input (`git apply -`,
  `jq`, a formatter) with the grant it already has.
* Good, because the change is additive: a write without `close` behaves as bridge v0 always did.
* Bad, because a caller that wants to close without writing still sends `data: ""`.

## More Information

`specs/bridge/v0/proc.schema.json` (`ProcWriteParams.close`), `crates/desk-sys/src/proc.rs`
(`Process::close_stdin`), `crates/desk-core/src/core_proc.rs`, `plugins/git/ui/hunks.js`. Issue #314.
