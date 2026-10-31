# plugins/mail

`endue.mail`, the mail surface, in the community folder format and on the public SDK only. One
`center` surface shows the `message` items of the desk's index (ADR 0032) as threads in mailboxes
(Inbox, Unread, Flagged, Sent, Drafts, Archive, Trash, Junk), opens a message, writes replies,
forwards and new mail, and answers meeting invitations. Requirements, decisions and the road ahead:
`docs/ko/mail-requirements.md`.

The plugin reads but never writes the index: every change goes through the commands the mail
connector provides, as ADR 0032 says. A connector `acme.imap` that brings messages in provides
`acme.imap.mail.send { instance, to, cc, bcc, subject, body, inReplyTo, references, replyTo, calendar }`,
`acme.imap.mail.move { instance, id, mailbox }` (a role: inbox, archive, trash, junk) and
`acme.imap.mail.flag { instance, id, unread, flagged }`. Buttons for actions a connector lacks are off.
In `raw` the plugin reads `mailbox` (a role, inbox when absent), `flagged`, `cc`, `attachments`
(`{ name, mime, size }`), `calendar` (the text/calendar part, as text), `messageId`, `inReplyTo` and
`references`.

A text/calendar part shows as an invitation card: when (in the person's zone, with the organizer's
zone when it differs), where, who, the rule as written. Accept, Maybe and Decline send an iTIP
`METHOD:REPLY` (RFC 5545, RFC 5546) through the connector as iMIP (RFC 6047), with the subject
`Accepted: <summary>`. The attendee is found among the invitation's attendees by the person's
addresses (`endue.mail.addresses`), else by the message's recipients.

Keyboard: `j` `k` or arrows move, Enter opens, `r` `a` `f` reply, reply all and forward, `e` archives,
`#` trashes, `s` flags, `u` toggles unread, `c` composes, `/` searches, `y` `m` `n` answer an invitation,
`Mod+Enter` sends, Escape puts the composer away (the draft stays). Chords reach the desk.

| Permission | Why |
| --- | --- |
| `data:read` (`message`) | List, search and follow messages in the index; asked once on a refusal |
| `cmd:invoke` (`*.mail.send`, `*.mail.move`, `*.mail.flag`, `desk.palette.pick`) | Act through the connector; ask for search words |
| `ui:notify` | Say that new mail arrived, when `endue.mail.notify` is on |

Settings: `endue.mail.page`, `.notify`, `.mark-read`, `.signature`, `.addresses`. The store keeps the
mailbox and selection (`view`), the drafts (`drafts`) and the answers given to invitations (`answers`).

```bash
pnpm exec vitest run plugins/mail
cargo run -p desk-cli -- plugin validate plugins/mail
```
