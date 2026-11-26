---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Chat and Mail drafts and reviewed delivery

## Context and Problem Statement

Eris could read named conversations and send messages through commands. Chat and Mail did not
offer the same drafts and navigation that people use, and Chat could show a second delete question
after the desk approved a call.

## Decision Drivers

- The target of a write is the conversation, thread or message the person can identify.
- A draft is available to review and a draft already being written is kept.
- Changes to what other people see wait for core approval.

## Considered Options

- Drive the plugin's palette and use the current selection.
- Expose the named target through the same composer and connector paths as the window.

## Decision Outcome

Chat reads the view and saved messages and uses the open conversation for unnamed reads. A draft
uses the named conversation or thread root and keeps different unsent text. Opening the composer for
a draft does not mark the conversation read. Agent send, edit, react and delete use the desk approval
policy. A core-delivered agent delete names its message and uses the one core decision. Deletion
from the window asks there as before.

Mail uses the same draft construction for a new message, reply or forward in the composer and in
the reviewed send command. The composer keeps the previous draft and supports reading and patching
the draft in view. A forward quotes the original and uses its account. The existing connector
move handles named mailbox changes and the reader's Move to Inbox in Archive and Trash.

## More Information

- Issue #736, Chat and Mail.
- ADR 0078, approval of irreversible agent calls.
- ADR 0088, commands as tools.
