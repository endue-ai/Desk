---
status: accepted
date: 2026-11-07
decision-makers: Team endue
---

# Eris sees the desk with every line, and the person's Claude Code can be her brain

## Context and Problem Statement

Eris runs her loop on the desk over plugin tools (ADR 0089), but a line reached the brain as text
alone. The windows, where they are, which one has the focus and which plugin each shows lived only in
the runtime's window manager (ADR 0040, 0082), so "summarise this", "the window on the left" or "open
Git" left the brain guessing which plugin was meant, and past 30 agent commands a turn offered only
desk-tools and desk-run (ADR 0088), even for the plugin in front of the person. The brain itself was
endue AI, Ollama or echo (ADR 0094); many people already have Claude Code signed in on the same
computer (ADR 0084) and want Eris to think with it. How does the brain learn what is on screen, and
how can Claude Code be the model while the desk keeps the loop, the tools and the permissions?

## Decision Drivers

* The person's line goes to the plugin they mean, with no extra round trip to look first
* One snapshot, made where the windows live (the runtime), worded once (the core) for every brain
* The desk keeps the loop: every tool call is an errand, under grants, the allowlist and approvals
* Claude Code must not act on its own: no built-in tools, MCP servers, hooks or saved sessions
* No key in the desk: Claude Code signs in with the person's own account; nothing new in the core's
  permissions or in `specs/brain`

## Considered Options

* brain.say carries the runtime's snapshot (`desk`); the core puts it in words before the line, with
  each plugin's tools; Claude Code is a model behind `LocalBrain`, asked with `--tools ""` and
  answering through `--json-schema`
* A desk tool only (`desk.windows.list`): the brain asks for the windows when it thinks of it
* Claude Code over MCP: it reaches the desk through desk-mcp (ADR 0086) and runs the tools itself
* The local-agents plugin's `ask` as the brain (ADR 0099): Eris forwards every line to Claude Code

## Decision Outcome

Chosen option: "brain.say carries the snapshot, and Claude Code is a model behind `LocalBrain`",
because the brain knows the desk before it answers, every brain gets the same words, and Claude Code
stays a model: the desk runs each call, so errands, prompts and approvals apply as for any brain.

* **The snapshot.** `BrainSayParams.desk` (`BrainDesk`): the screen and up to 64 windows front to back,
  each with its rect on screen, `floating`, `focused`, `hidden` (in the drawer) and its panes (`view`,
  `plugin`, `title`, `focused`). The composer sends `deskSnapshot()` with every line.
* **In words.** The core makes the snapshot the first text part of the turn's message (the line is the
  last), one line per window with its place ("right", "top left", "off screen") and, the first time a
  plugin appears, its tools by name. Sessions keep only the line. brain-echo reads only the last part.
* **Tools of what is on screen first.** When the agent commands do not all fit in a turn, those of the
  plugins on screen (the focused one's first) and the desk's own are offered by name as far as they fit.
* **Looking again, bringing up.** `desk.windows.list` (read-only) answers the same snapshot mid-turn;
  `desk.plugins.open` is now an agent command, so Eris can open the plugin a request needs.
* **Claude Code as a brain.** `brain.use: claude` (`BrainName` gains `claude`, reported as `cloud`).
  `LocalBrain::claude_code` keeps sessions and leases as for Ollama; each answer is one
  `claude -p --tools "" --safe-mode --strict-mcp-config --disable-slash-commands
  --no-session-persistence --permission-mode dontAsk` run in `<data>/claude-brain`, the turn's tools
  in `--system-prompt`, `{ say, calls }` through `--json-schema`, the conversation on stdin.
  `DESK_CLAUDE_PATH` and `DESK_CLAUDE_MODEL` move it; otherwise PATH and the installers' folders.
  Offline, overloaded or missing is `Unreachable`, so the local brain stands in (ADR 0094).

### Consequences

* Good, because "this" and "the window on the left" reach the plugin the person sees, in one turn.
* Good, because Claude Code's own subscription answers Eris with no key in the desk, and it can never
  run a program or change a file: only the desk's tools run, each as an errand.
* Bad, because every line sends the snapshot: a few hundred tokens per turn, kept in a local brain's
  history, and it names the person's windows and plugins to the brain they chose.
* Bad, because each Claude Code answer starts a program (two to five seconds) and answers whole, not
  streamed; a long conversation is sent again every time, up to 120 kB, older lines left out first.
* Bad, because `--safe-mode` and the other flags need a recent Claude Code; an older one is refused
  with a line that asks to update it, not asked again without them.
* Neutral: `docs/ko/desk-requirements.md` names the brains; the maintainers update that source.

## More Information

Specs: `specs/bridge/v0/brain.schema.json` (`BrainDesk`, `BrainName`). Core: `desk_context.rs`,
`conversation.rs`, `core_tools.rs` (`offer`), `brain_choice.rs`. Brain: `crates/desk-brain-local`
(`model.rs`, `claude.rs`, `claude_prompt.rs`). Runtime: `shell/desk-view.ts`, `shell/Composer.ts`,
`runtime.ts` (`desk.plugins.open`), `shell/Rail.ts`. App: `apps/desk/src-tauri/src/brains.rs`,
`apps/desk/src/shell-bridge.ts`. Builds on ADR 0040, 0084, 0088, 0089 and 0094.
