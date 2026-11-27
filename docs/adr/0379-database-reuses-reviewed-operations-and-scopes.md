---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Database reuses reviewed operations and scopes

## Context and Problem Statement

Eris needs to read the Database console and prepare SQL, grid edits and forms. The core and plugin
both reviewed some destructive actions. Connecting could ask about a password helper separately.

## Decision Drivers

- Preserve connection and column visibility controls on agent reads.
- Keep SQL drafts and pending grid changes separate from execution.
- Tie approval to the reviewed operation and permission scopes.

## Considered Options

- Add a separate agent SQL and permission interface.
- Reuse the editor, grid, command invocation and permission prompts.

## Decision Outcome

Read the active buffer as bounded data. Apply column-name masking and omit results that derive
sensitive values under another name. Leave credential-bearing statements, raw plan text and
table values from pending edits on screen. Draft SQL and stage changes using the existing editor
and grid. The person chooses import files and export destinations.

Core sends its authenticated approval flag to the enabled built-in Database for drop, truncate,
drop policy and end session. A review needs a complete target. The provider runs that operation
without repeating the question, with its read-only checks and server safeguards in force.

Save and Test request the exact database and helper permissions they lack. Permissions can show
the paired requests in one card and answers the scopes shown there. Exact helper consent is kept
by connection and command. Agent reads require a connection grant and cannot open a password
question. Desk search carries the agent's identity into read-only providers.

### Consequences

- A reviewed operation has one confirmation. A person's direct operation retains its existing review.
- Agent tools reuse the person's pending edits and read models without submitting changes.
- Existing connection and file formats remain in use.

## More Information

- [Issue #728](https://github.com/endue-ai/endue/issues/728)
- [ADR 0346](0346-agents-read-the-database-read-only-masked-and-on-an-audit-list.md)
