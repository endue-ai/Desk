---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Eris runs safe desk commands without a scope prompt

## Context and Problem Statement

[ADR 0296](0296-eris-runs-her-own-desk-commands-and-sweep-hands-her-what-the-person-drew.md) lets Eris work
with her windows, her model and the sweep without a scope prompt. Opening a file or a plugin
and checking the desk's capabilities still interrupts the first request of each session.

## Decision Drivers

- Keep ordinary desk navigation available as soon as the person asks for it.
- Preserve the allowlist, permission log and approval of irreversible actions.
- Keep the person's choice to turn off a plugin in force until they grant scope to open it.

## Considered Options

- Extend the core's command list and use the registered read-only marker.
- Introduce a marker that the desk supplies when it registers a command.

## Decision Outcome

Use the core's list for reversible desk commands and the existing `readOnly` marker for
queries provided by `desk`. `desk.agents.transcript` still asks because it can show another
agent's conversation. Other agents keep the ordinary scope check.

`desk.plugins.open` depends on its arguments and the installed plugin's state. Eris can show
an enabled UI plugin or a built-in data view using its registered view provider. Other data
openers run through the ordinary scope check because an opener can name another command. If a
plugin changes state between the core check and the runtime launch, the runtime requests the
same command scope before enabling it.

### Consequences

- The core applies `agents.eris.allow` and logs each use of the exception on `perm`.
- A command marked irreversible keeps the scope and action checks from
  [ADR 0368](0368-desk-marks-irreversible-commands.md).
- `cmd.tools` marks unconditional desk commands granted. Opening a plugin still needs its
  arguments before that determination can be made.

## More Information

- [Issue #719](https://github.com/endue-ai/endue/issues/719)
