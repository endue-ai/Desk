---
status: accepted
date: 2026-11-27
decision-makers: Team endue
---

# Git Studio uses authenticated provider CLIs

## Context and Problem Statement

Git Studio reads the local repository through Git. Pull and merge requests, workflow runs and releases
live on the configured origin and need its account and permissions.

## Decision Drivers

- Bind the dashboard and each mutation to the named origin.
- Reuse the person's provider account without storing credentials in the plugin.
- Keep provider branch rules and release permissions in force.

## Considered Options

- Use the provider CLIs through the public process bridge.
- Add provider sign-in and write APIs to Desk's core.
- Link from Git Studio to provider websites.

## Decision Outcome

Use `gh` for github.com and `glab` for gitlab.com, with a fixed hostname and explicit repository path
on every request. Open the dashboard on demand. Read request, run and release lists independently and
load job details when the person requests them. Nest open requests when the target repository and
branch uniquely match another request's source.

Mutations are window actions. Their forms name the repository and resource. Studio checks origin
after confirmation and sends the reviewed source SHA with a merge. The provider enforces required
checks and account permissions. Publishing uses an existing origin tag.

### Consequences

- Desk needs no separate sign-in or credential storage for this dashboard.
- Hosted data requires an installed and authenticated provider CLI. Local Git is available separately.
- The dashboard supports github.com and gitlab.com. Custom hosts need explicit provider configuration
  before a CLI can be called with their credentials.

## More Information

ADR 0384 covers Git Studio's agent commands and local operations.
