---
name: add-adr
description: Add the next numbered ADR to docs/adr/ in MADR format for a decision that is hard to reverse. Use as /add-adr <short title>.
argument-hint: <short title>
---

# add-adr

The argument is a short title: $ARGUMENTS.

## Steps

1. Find the next number: the highest `docs/adr/NNNN-*.md` plus one, four digits (`ls docs/adr`).
2. File name: `docs/adr/NNNN-<kebab-case-title>.md`, three to six words.
3. Write it with the template below. Keep it under one screen: context in a few sentences, real options
   that were considered, the decision and its consequences both good and bad.
4. If the decision changes the design, say which section of `docs/ko/desk-structure.md` must be updated
   and update `docs/architecture.md` if the summary is affected.
5. Commit with the change it belongs to: `docs(adr): NNNN <title>` and `git commit -s`.

## Template

```markdown
---
status: accepted
date: YYYY-MM-DD
decision-makers: Team endue
---

# <Decision as a short statement>

## Context and Problem Statement

## Decision Drivers

* <driver>

## Considered Options

* <option>

## Decision Outcome

Chosen option: "<option>", because <reason>.

### Consequences

* Good, because <...>
* Bad, because <...>

## More Information

<links: design section, issue, PR>
```

Status is `accepted` because merging the PR is the decision; if the PR is rejected the ADR goes with it.
A later decision that reverses this one is a new ADR with `status: accepted` that names this one, and this
one becomes `status: superseded by NNNN`.
