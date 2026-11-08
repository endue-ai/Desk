# plugins/chat-digest

`endue.chat-digest`, every chat at a glance: a `view` plugin, data only, whose one view is a page of
universal views inline in `plugin.json` (`UniversalPage`, `specs/view/v0`, ADR 0103).
`desk.universal` draws it; nothing here runs. It is the dashboard companion of `endue.chat`
(`plugins/chat`): the same chat messages (`message` items with `raw.channel`), from every service.

| Section | Presentation | Items query | Empty |
| --- | --- | --- | --- |
| Unread · Mentions · Direct | three `stat`s | unread chat messages; those with `raw.mentioned`; those whose `raw.channelKind` is `dm` or `group` (500 counted) | All caught up. · No one is waiting on you. · No direct messages waiting. |
| Mentions | `list` | unread mentions, newest first, 10, the channel as detail | No one is waiting on you. |
| Direct messages | `list` | unread direct and group messages, newest first, 10 | No direct messages waiting. |
| Latest across every chat | `list` | every chat message, newest first, 25 | No chat messages yet. |

Three columns: the counts over the lists. No query names a source, so one digest covers Slack,
Discord and the rest together. Every entry's actions are `endue.chat`'s commands with the item's
`{ source, id }`: Open in Chat (`endue.chat.show`) and, for a mention, Reply in thread
(`endue.chat.reply`); Enter runs the first.

| Contribution | What it does |
| --- | --- |
| `endue.chat-digest.open` | "Open the chat digest": an alias (`runs`) the desk answers with `desk.views.open { id: "endue.chat-digest" }` |

```bash
pnpm exec vitest run plugins/chat-digest
cargo run -p desk-cli -- plugin validate plugins/chat-digest
```
