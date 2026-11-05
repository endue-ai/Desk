---
status: accepted
date: 2026-11-04
decision-makers: Team endue
---

# Local agents run their own command-line programs, read-only by default

## Context and Problem Statement

People already have agent programs on their computers: Claude Code, Codex (OpenAI), Gemini CLI, Grok
CLI and others, each signed in with its own account. AG-09 says external agents attach as plugins
and are offered only when the person names them (the first-run rule: Claude and Codex are not on by
default). `endue.local-agents` asks them questions from the desk, in a chat, side by side and on a
board of tasks. How does it reach them, and what may they do when it does?

## Decision Drivers

* Use the person's own installs, sign-ins and subscriptions: no API keys in the desk
* The narrowest grant: named programs, no shell, nothing new in the core
* Every program speaks its own output format, and those formats change between versions
* A program the desk starts must not change files unless the person chose that
* Not on by default, and not offered first

## Considered Options

* Each program's non-interactive mode through `proc.spawn`, reading its structured output
* Each vendor's HTTP API through `net.fetch`, with keys the person enters
* Each program in a terminal (`endue.terminal.run`), the person typing

## Decision Outcome

Chosen option: "the non-interactive mode through `proc.spawn`", because it reuses what the person
installed and signed in to, needs only `proc:spawn` for eight named programs, and gives the plugin
the text, tools and sessions to draw instead of a terminal's screen.

* **A catalog is data.** `ui/catalog.js` says, per program, its arguments, how it resumes a session,
  how it takes a model, its read-only flag and its install line. A new program is one entry and one
  manifest line. Programs are found by `--version`, all at once.
* **Read their own formats, and degrade.** stream-json (Claude, Cursor, Gemini) and JSON lines
  (Codex in both its old and new shapes, Grok) are read into one reply; a line no reader knows is
  text. A version that refuses the structured output flags is asked again for plain text, once, and
  remembered; a session that cannot be resumed is asked again with the earlier turns in the prompt.
* **Read-only by default.** `endue.local-agents.access` is `read-only`: Claude Code runs in plan mode
  and Codex in its read-only sandbox; Gemini, Qwen and Copilot leave out tools that need approval
  when no person can approve. Grok CLI, Cursor Agent and OpenCode have no such mode, so the desk asks
  once per session before running them. No flag that widens a program's permissions is ever passed;
  a read-only flag is never dropped by a fallback. `agent` hands each program its own settings.
* **The prompt is one argument.** No shell; a leading dash gets a space so no program reads the
  prompt as an option; NUL is removed.
* **`autoload`.** Installed but off until the person turns it on, so the first-run rule holds.

### Consequences

* Good, because whatever works in the person's terminal works in the desk, with their accounts.
* Good, because the plugin needs no new bridge method, no network grant and nothing in the core.
* Bad, because the desk cannot see or limit what a program does inside its own process: read-only is
  only as strong as each program's mode, which the Agents view says for each one.
* Bad, because bridge v0 cannot close stdin, so a program that waits for stdin pauses first (Claude
  Code waits three seconds); the prompt goes as an argument, up to 100,000 characters.
* Bad, because an app started from the Finder has the system's PATH: the plugin tries the usual
  folders once and offers `endue.local-agents.path`, as the Docker plugin does (ADR 0039).

## More Information

`plugins/local-agents/README.md`; AG-09 in `docs/ko/desk-requirements.md`, the first-run rule in
`docs/ko/first-run-scenario.md`; ADR 0039 (a plugin that drives a CLI), ADR 0046 (autoload), ADR
0072 (the desk's own agents, which are callers and are not these programs).
