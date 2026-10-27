---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Auto-merge only bot dependency PRs; people approve task PRs

## Context and Problem Statement

Most work arrives as pull requests written by AI agents, and dependency updates arrive from bots. Which
pull requests may merge without a person?

## Decision Drivers

* A person decides every change in behaviour
* Routine dependency patches should not pile up
* The approve-or-reject moment stays one click on an As-is → To-be table

## Considered Options

* Auto-merge bot PRs for patch and minor dependency updates only
* Auto-merge any PR that passes the gates
* Never auto-merge

## Decision Outcome

Chosen option: "auto-merge bot dependency PRs (patch and minor) only". They merge when all gates pass.
Every task PR, whether written by a person or an AI agent, needs a human approval, and that approval is
the decision.

### Consequences

* Good, because people stay in charge of behaviour and AI-authored work.
* Good, because dependency patches flow without manual effort.
* Bad, because a major dependency update still waits for a person.

## More Information

Design: `docs/ko/desk-structure.md`, sections "저장소 설정" (repository settings) and "결정".
