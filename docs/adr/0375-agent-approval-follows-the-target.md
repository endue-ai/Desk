---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Browser and computer approvals follow the target

## Context and Problem Statement

The Browser asks separately for each command during a form fill. Moving the pointer or scrolling in
a native app also requires approval. The agent needs to know whether the OS permits computer use,
whether the person stopped it, and which apps the person already approved.

## Decision Drivers

* A Browser approval lasts for one view and site during a single turn.
* A native app allowance lasts for the current conversation and can be revoked with Stop.
* The core determines the target from the view or window it observes and keeps the existing permission checks.

## Considered Options

* Keep the Browser command ID as the target and offer a separate task answer for each verb.
* Move the review to the operation on the view or the native app after resolving its target.

## Decision Outcome

The built-in Browser supplies its pending agent invocation for click, type, key and select. The core
checks the provider and matching verb and accepts one mutation from that invocation. The target is
the view ID and its HTTP(S) origin. A task allowance covers those verbs in that view and origin until
the turn ends. Scheme and port changes require another approval. The core rechecks the view after
the card and the shell still checks the origin as it dispatches the operation.

Native pointer movement and scrolling use the existing OS, app and stop checks without an
action card. A scroll without coordinates looks up the pointer position. When a card offers an
app allowance, it applies to that agent and bundle ID across turns. Changing conversations
or stopping computer use clears it. A drag between apps and every quit require a fresh card.
The read-only Computer status command reports OS permissions, the stop flag and the agent's
allowed apps.

### Consequences

* A form fill or native app session can proceed after the person reviews its first action.
* A move to another view, site or native app can require a new card. The agent can read Computer
  status to explain an OS permission or a stop to the person.
* App allowances live in memory and must be given again when the desk restarts.

## More Information

Implements [#724](https://github.com/endue-ai/endue/issues/724) and amends
[ADR 0123](0123-eris-uses-the-computer-under-computer-grants-and-approvals.md) and
[ADR 0272](0272-a-web-views-page-is-read-and-operated-under-a-grant-of-its-own.md).
