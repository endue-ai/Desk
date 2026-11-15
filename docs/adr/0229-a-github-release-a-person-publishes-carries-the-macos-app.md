---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0054 (a GitHub Release links to R2, without binaries: that stays for a final's release
only) and ADR 0092 (a second way a `v*` tag gets a build, beside the line's final).

# A GitHub Release a person publishes carries the macOS app

## Context and Problem Statement

`release-build.yml` builds the CEF desk (ADR 0143) for macOS as cargo-packager's `.app` and `.dmg`,
signed helper by helper (ADR 0145), for `darwin-aarch64` and `darwin-x86_64`. Only the line pipeline
calls it to publish (ADR 0092): canary nightly, a candidate on a push to `release/vX.Y`, a final by
hand. Each of those needs the updater key and its public key, the R2 bucket, the `signing` and
`stable` environments and the release GitHub App, and each stops or builds nothing without them. On
2026-11-15 the repository has none of them (no environment, secret or variable), no tag and no
release, so no release can produce a macOS app, and nothing runs when a person publishes a GitHub
Release. The person asked that a release build the macOS app. What builds it, from which trigger,
with which signature, and where does the app go?

## Decision Drivers

* A release produces a macOS app before the line pipeline's settings exist
* One build recipe: the same `release-build.yml` steps, pin of CEF, packager and install smoke
* The line pipeline, its versions and its updater trust stay as they are
* A person who downloads the app knows whether Apple knows it

## Considered Options

* A published GitHub Release starts `release-macos.yml`, which builds the two macOS targets through
  `release-build.yml` and attaches each `.dmg` to that release
* A push of a `v*` tag builds and creates the release
* Let canary, a line and its final build and publish without the updater key and R2
* A recipe a maintainer runs on a Mac (`just package-shell`) and uploads by hand

## Decision Outcome

Chosen option: "a published GitHub Release starts `release-macos.yml`", because publishing a release
is the one act a person already takes for it, the build is the line pipeline's own, and nothing in
the line pipeline has to trust an unsigned index.

* **Trigger.** `release: published`, and `workflow_dispatch` with the tag of an existing release (a
  failed run again, or a release from before this workflow). The tag is `vX.Y.Z` or `vX.Y.Z-<pre>`
  and names the version in the app; any other tag fails the run.
* **A final's release builds nothing here.** `release-final.yml` makes its release with the release
  app, whose author is a bot; its build is on R2 and its notes link there (ADR 0054). A release with
  a bot as author is skipped.
* **What is built.** `release-build.yml` with `targets: darwin` and `installers-only: true`: the two
  macOS targets at the tag's commit, apart, with no universal build (ADR 0054). No updater signature
  is made and only the `.dmg` leaves the build, so the run needs no updater key and no R2. The
  updater's public key is embedded when the repository variable is set, as in every build; without
  it the app does not update itself.
* **Signing.** With `APPLE_CERTIFICATE` and `APPLE_SIGNING_IDENTITY` in `signing` the app and the
  disk image are signed with the Developer ID, notarised and stapled, and a build that is not fails
  (`DESK_REQUIRE_NOTARISATION`, `DESK_REQUIRE_SIGNED`). Without them the build is ad-hoc signed and
  still ships: the run warns, and the release's notes say the build is not notarised and how to open
  it. A release does not wait for a certificate.
* **Names.** `endue-desk_<version>_darwin-aarch64.dmg`, `endue-desk_<version>_darwin-x86_64.dmg`
  (the names R2 uses) and `SHA256SUMS-macos`, attached to the release; a run for the same tag
  replaces them. The notes get one macOS section between two markers, replaced on a later run.
* **The tag counts.** `release-version.mjs` reads every `vX.Y.Z` tag: a tag a person publishes moves
  canary's next version and a line's next patch as a final's tag does.

### Consequences

* Good, because publishing a release yields a macOS app with no setting beyond the repository
* Good, because the app is the line pipeline's build: the same pin, packager, signing and smoke
* Good, because a final and the updater's trust are untouched: nothing here writes R2 or an index
* Bad, because there are two ways to a `v*` tag; once `protect-release-tags` is applied only the
  release app and administrators can make one, and this path is theirs
* Bad, because an ad-hoc build meets Gatekeeper: the person must allow it by hand
* Bad, because desks installed from such a release update only when the public key was set at build
  time and a newer build is listed on their channel
* Bad, because Windows and Linux get nothing from this path

## More Information

`docs/releasing.md`, "Publish a GitHub Release with the macOS app". The workflow's shape is held by
`scripts/ci-release-macos.test.mjs`, the files and notes by `scripts/release-assets.test.mjs`. The
`signing` environment's deployment rule must admit the tag (`v*`) for a run started by a release.
