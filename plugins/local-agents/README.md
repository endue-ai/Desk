# plugins/local-agents

`endue.local-agents`, the agent programs installed on this computer, asked through their
non-interactive modes, in the community folder format and on the public SDK only. It knows Claude
Code (`claude`), Codex (`codex`, OpenAI), Gemini CLI (`gemini`), Grok CLI (`grok`), Qwen Code
(`qwen`), Copilot CLI (`copilot`), Cursor Agent (`cursor-agent`) and OpenCode (`opencode`), finds
which are there by their `--version`, and reads each one's own output: stream-json (Claude, Cursor,
Gemini), JSON lines (Codex, Grok), plain text (the rest). Five views (`1`–`5`): **Agents** (found,
versions, how each is held read-only, how to install the missing), **Chat** (one conversation per
agent; Claude, Codex and Cursor resume their own session, the others get the earlier turns in the
prompt), **Compare** (one question to several agents, answers side by side), **Board** (a kanban of
cards To do → Running → Done / Failed; drag, `[` `]`, or Run; `endue.local-agents.parallel` at once)
and **Activity** (every run, its command and answer). Why and how: ADR 0084.

The plugin is `autoload`: installed but off until the person turns it on (the first-run rule: Claude
and Codex are not on by default). Programs run through `proc.spawn` without a shell; the prompt is one
argument a leading dash cannot turn into an option. With `endue.local-agents.access` `read-only` (the
default) Claude runs in plan mode and Codex in its read-only sandbox, and the desk asks once before
running a program nothing holds read-only. No flag that widens a program's permissions is ever passed.

| Permission | Why |
| --- | --- |
| `proc:spawn` (the eight programs) | Find them by their version and ask them; one grant covers all |
| `cmd:invoke` (`desk.palette.pick`) | Ask for a prompt, an agent or a model; confirm an unguarded program |

| File | Purpose |
| --- | --- |
| `ui/catalog.js` | The programs: arguments, resume, model, read-only flags, install lines |
| `ui/parse.js`, `ask.js`, `run.js`, `detect.js` | Output readers; one question with its second tries; the runner; versions |
| `ui/agents.js`, `talk.js`, `tasks.js`, `runs.js` | The controller; chat, compare, ask; the board's queue; the runs |
| `ui/chat.js`, `board.js`, `store.js`, `settings.js` | Conversations and cards kept under 64 KiB per key; settings |
| `ui/model.js`, `commands.js`, `schemas.js`, `plugin.js` | The view model; `endue.local-agents.*` with schemas; wiring |
| `ui/view*.js`, `keys.js`, `dom.js`, `style.css` | The DOM of the five views, keys, theme tokens only |

```bash
pnpm exec vitest run plugins/local-agents
cargo run -p desk-cli -- plugin validate plugins/local-agents
```
