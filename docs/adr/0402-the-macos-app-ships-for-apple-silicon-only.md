---
status: accepted
date: 2026-11-28
decision-makers: Team endue
---

# The macOS app ships for Apple silicon only

## Context and Problem Statement

Releases built a disk image for Apple silicon and one for Intel (ADR 0229). The Intel build signs and
notarises, but no hosted runner can launch it. An Intel runner has no Metal GPU, and the app needs
Metal, so it exits at start (release-dry-run, 2026-11-24). On an Apple silicon runner under Rosetta it
printed no ready line within the smoke's time (release-macos for v0.5.0, 2026-11-28). 0.4.0 shipped its
Intel image without a launch. Should a release carry a build nobody has launched?

## Decision Drivers

- A release ships only what its pipeline has installed and launched.
- The app requires Metal; Intel Macs that run current macOS are a shrinking share.
- 0.5.0 is the first signed release; it should not wait on an Intel test machine.

## Considered Options

- Apple silicon only.
- Keep Intel and skip its launch in the smoke, saying so in the notes.
- Keep Intel and launch it on a self-hosted Intel Mac with Metal.

## Decision Outcome

Chosen option: Apple silicon only, from 0.5.0. `release-build.yml` builds `darwin-aarch64` for macOS,
and `release-macos` attaches `endue_<version>_darwin-aarch64.dmg` and `SHA256SUMS-macos`.
`cef-fetch` and `release-collect` keep the Intel target, so a person can still build it on an Intel
Mac.

### Consequences

- Good: every macOS download has passed install, signature and launch checks in the pipeline.
- Good: one macOS build per release, about half the macOS runner time.
- Bad: Intel Macs get no new release. An Intel install of 0.4.0 or earlier keeps working; it cannot
  update itself (those builds carry no updater key), so nothing breaks for it.
- Bringing Intel back needs a runner that can launch it, and a new ADR.
