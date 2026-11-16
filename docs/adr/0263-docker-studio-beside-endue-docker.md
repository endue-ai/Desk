---
status: accepted
date: 2026-11-17
decision-makers: Team endue
---

# Docker Studio is a graphical Docker client beside endue.docker, and AI's docker commands run only from a list, after the person agrees

## Context and Problem Statement

`endue.docker` (ADR 0039, ADR 0114) is a keyboard-first list: one key per action, a pane beside the
list. People who meet Docker through a window want something else: a dashboard that says what runs and
what fails, a table grouped by Compose stack with buttons and menus, a container's logs, stats, files
and a shell on one page, forms that write `docker run` and `docker build` for them, a map of a stack,
clean-up that says what it frees, and an assistant that says why a container died. Reshaping
`endue.docker` into that would break the keys and saved state its users rely on. And an assistant that
proposes docker commands needs a rule for when those commands may run.

## Decision Drivers

* Keep `endue.docker`'s keys, commands and state as they are
* Every operation is still the docker program through `proc.spawn` without a shell, every value checked
* AI may suggest; only the person decides what runs, seeing the exact command first
* Secrets in containers' environments never leave for the brain
* Files are written only where the person names, with a grant for that folder alone

## Considered Options

* Grow `endue.docker` into the graphical client
* A second plugin, `endue.docker-studio`, beside it (the shape `endue.git-studio` took beside `endue.git`)
* AI's commands run as given, or are refused, or run from a list after the person agrees

## Decision Outcome

Chosen option: a second plugin, `endue.docker-studio`, and AI's commands run from a list after the
person agrees, because the two ways of working serve different people and neither should cost the other
its habits, and because an assistant that cannot act is half a help while one that acts alone is a risk.

* The studio asks for `proc:spawn` (`docker`), `brain:ask`, `shell:open` (http, https), `cmd:invoke`
  (`endue.terminal.run`, `desk.files.open`) and `fs:read` / `fs:write` under the home folder; each write
  asks for the one folder the person typed, and asks again before replacing a file.
* Each question to the brain goes with a tool whose arguments are the answer; prompts carry variables'
  names, never their values.
* A suggested command runs only if its first word is one of docker's subcommands on a short list, holds
  no `--privileged`, host namespace, host network, Docker socket or system-folder mount, and the person
  agreed to the exact line in a confirmation, every time.

### Consequences

* Good, because each plugin keeps its people: keys for some, a window for others, on the same engine
* Good, because the assistant can fix what it diagnoses, and a mistake costs a click of No
* Bad, because two plugins read the same engine: both may stream `docker events` and `docker stats`
  when both are open
* Bad, because the list of subcommands has to grow with docker, or a good suggestion is refused

## More Information

`plugins/docker-studio/README.md`; the list is `ui/ai-commands.js`, the prompts `ui/ai-prompts.js`.
ADR 0039 (docker through the CLI), ADR 0088 (commands as agents' tools), ADR 0114 (endue.docker's
overview).
