# plugins/chat

`endue.chat`, every chat service in one interface, in the community folder format and on the public SDK
only. One `center` surface shows the chat messages of the desk's index (ADR 0032), whichever connector
brings them in (Slack, Discord, Microsoft Teams, Telegram, Matrix, IRC and others), by service and
workspace, with threads, reactions and replies. Requirements: `docs/ko/chat-requirements.md`.

A chat message is a `message` item whose `raw.channel` names its conversation; the mail plugin leaves
those out. The plugin also reads `raw.channelName`, `.channelKind` (`channel`, `private`, `dm`,
`group`), `.platform` (else the connector id), `.workspace`, `.topic`, `.self`, `.mentioned`,
`.replyCount`, `.broadcast`, `.reactions` (`{ emoji, count, self }`), `.attachments`, `.editedAt`,
`.pinned` and `.bot`; a reply's `thread` is its root's id. It never writes the index: a connector
`acme.slack` provides `acme.slack.chat.send { instance, channel, text, thread? }`, `.chat.react
{ instance, channel, id, emoji, on }`, `.chat.read { instance, channel, id }`, `.chat.edit { ..., id,
text }` and `.chat.delete { ..., id }`. Buttons for actions a connector lacks are off.

Layouts: Conversation (the list, the conversation, its thread), Inbox (unread conversations as cards,
the ones that call you first, answered in place), Timeline (every service as one stream, under the
filters and search) and Columns (pinned conversations side by side). Filters: All, Unread, Mentions,
Direct, Saved. Text is drawn node by node, never as HTML; links open through `shell.open`. With no
account connected the page says why, and Connect an account when a message connector is installed.

Keys: `1`–`4` layouts, `j` `k` messages, `[` `]` conversations, `n` next unread, Enter the thread, `r`
reply, `e` edit, `+` react, `s` save, `Delete` delete, `m` mark read, `p` pin, `c` write, `/` search,
Escape. In a composer Enter sends (never while an IME composes), Shift+Enter is a new line, ArrowUp
edits your last message. Chords reach the desk. `Mod+Shift+J` opens it; the palette finds conversations.

| Permission | Why |
| --- | --- |
| `data:read` (`message`) | List, search and follow chat messages in the index; asked once on a refusal |
| `cmd:invoke` (`*.chat.*` actions, `desk.palette.pick`, `desk.connectors.open`) | Act through each connector; pick and confirm; lead to connecting an account |
| `ui:notify` · `shell:open` (http, https, mailto) · `connector:manage` | New DMs and mentions (`notify`); a message's links; the installed message connectors an empty desk names (`connector.list`) |

Settings: `endue.chat.page`, `.notify`, `.mark-read`, `.enter-sends`, `.density`, `.quick-reactions`.
The store keeps the layout, filter, service, conversation and columns (`view`), `drafts` and `saved`.

```bash
pnpm exec vitest run plugins/chat
cargo run -p desk-cli -- plugin validate plugins/chat
```
