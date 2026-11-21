---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Desk discovers signed upgrade paths on GitHub Releases

## Context and Problem Statement

The staging updater reads signed channel indexes from R2 (ADR 0054). A manually published
GitHub release carries macOS disk images (ADR 0229). People looking at the releases page and
installed desks need the same source of available versions.

## Decision Drivers

Preserve signed installs, required intermediate versions, choice of installation time and
the existing release lines.

## Considered Options

* Publish each version's compatibility limits and signed packages on its GitHub release.
* Attach a cumulative catalog to the release marked latest, and copy older entries to every new tag.

## Decision Outcome

Each published version advertises its own signed v0 index as `UPGRADE_PATH.json`. The desk
considers all published tags and chooses the highest directly reachable version on its channel
for its platform. Tag-local paths let a maintainer withdraw a build or change its rollout without
copying history across releases. Preview lines publish their existing evolving catalogs on two
named prereleases. R2 continues to serve older binaries and preview artifacts.

The user can install a verified download immediately, leave it staged, or authorize that version
for the next start. Desk consumes the authorization before calling the installer and rechecks the
download locally. A failed install requires another choice.

### Consequences

A release needs the updater key to offer automatic installation. Previously shipped installer-only
builds require a manual installation to enter the new update path. Checking older installations
can require multiple pages from the GitHub Releases API.

## More Information

This amends the release origin in the build and distribution sections of the Korean design.
See the [release contract](../../specs/update/v0/README.md) and [issue #512](https://github.com/endue-ai/Desk/issues/512).
