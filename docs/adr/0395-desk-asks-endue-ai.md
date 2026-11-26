---
status: accepted
date: 2026-11-27
decision-makers: Team endue
---

# Desk asks endue AI through its conversation API

## Context and Problem Statement

ADR 0129 gives Desk an agent card and a space window on the same account as endue.ai. The web
at develop `141a884a1` creates an agent conversation, resolves a space's Front Desk conversation,
and runs a turn through the conversation's Server-Sent Events endpoint. Desk needs those
targets to answer its own questions and Eris's delegated questions.

## Decision Drivers

- Name the exact selected agent and space in the review and on the server.
- Keep the endue ID session in the core and use the platform conversation authorization.
- Return a completed reply to the requesting Eris turn.

## Considered Options

- Drive the signed-in web page from Eris and read the DOM of its conversation.
- Use the same platform calls from Desk's native agent and space windows and expose a Desk tool.

## Decision Outcome

The agent card and the space's Front Desk expose a native question form. Eris lists targets via
`desk.endue.agents` and `desk.endue.spaces` and can read detail through `desk.endue.space`.
`desk.endue.ask` holds the exact agent, optional space and question for Core approval.
The runtime's `studio.chat.ask` access stays with the shell under `studio:manage`. A card's
explicit submit also uses this adapter. The core verifies that the personal agent is active
or that the current space and the server-bound Front Desk match the reviewed target.

Personal questions open a new conversation at the web's `ask` approval level. Space questions
use the server's existing Front Desk conversation and its policy. The run sends the reviewed
question and an idempotent message ID. The response reader has a 90-second deadline and a 2 MiB
body limit. It hands back only the completed assistant text or an unfinished state with the
conversation reference. The person's browser can open that conversation for pending input or
review. The command response goes to Eris as source material through the originating tool call.

## Consequences

- Agents, space members, work, results and rooms continue to use the native cards and the
  existing platform reads.
- A space can change its Front Desk while the person reviews. A stale binding gets a failure
  before the question is sent.
- A closed stream or timeout can leave the remote run in progress. Its conversation identifies
  where the person can follow it.

## More Information

- [Issue #802](https://github.com/endue-ai/endue/issues/802)
- [Platform API](../../specs/platform/v0/README.md)
- [Testing](../qa/TESTING.md)
