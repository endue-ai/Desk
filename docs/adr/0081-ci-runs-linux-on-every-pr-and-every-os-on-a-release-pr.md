---
status: accepted
date: 2026-11-03
decision-makers: Team endue
---

# Pull requests into main run on Linux; a pull request into release/vX.Y.Z runs every OS and merging it releases

## Context and Problem Statement

Every pull request and every merge-queue entry ran check and unit tests on Linux, macOS and Windows,
and built the Tauri app on all three when the shell changed (ADR 0015). Every push to `main` then
built four release targets for canary (ADR 0054), and a tag `v*` started the stable release. Windows
alone took 15 minutes a run and sometimes passed the 30-minute limit on a busy runner (#388, #390),
so one slow runner held a pull request back while dozens of agents work at once. Most changes never
behave differently on macOS or Windows; the place to prove that is the release. Where does each OS
run, and what starts a release?

## Decision Drivers

* A pull request and the merge queue answer in the time a Linux run takes
* Nothing reaches people without every OS checked and every target built
* A release is a reviewed change, with its checks on the pull request, not a tag pushed by hand
* The signing and stable environments and their approvals stay as they are

## Considered Options

* Linux on every pull request; every OS on a pull request into `release/vX.Y.Z`; merging it releases
* Every OS on every pull request, with longer timeouts (as today)
* Linux on pull requests and every OS nightly on `main`, releases still from a tag

## Decision Outcome

Chosen option: "Linux on every pull request; every OS on a pull request into `release/vX.Y.Z`;
merging it releases", because the per-change cost drops to one OS while a release still cannot leave
without every OS and every target behind it.

* **Into `main` and in the merge queue**: `check (linux)`, `runtime-e2e`, `codegen-check`,
  `red-on-base`, `app-build` on Linux when the shell or the primitives change, and the other Linux
  workflows (security, scope-check, plugin-validate, e2e). `check (macos)`, `check (windows)` and the
  macOS and Windows app builds are skipped, which the required `ci` aggregate counts as passed.
* **A release** is a pull request from `main` into `release/vX.Y.Z`, a branch a person creates first.
  Its `ci` also runs check and unit tests on macOS and Windows, `app-build` on all three OSes and the
  release dry run (`release-dry-run.yml`, called from `ci`): every target built and signed with a
  throwaway key and the R2 tree written.
* **Merging it** pushes to `release/vX.Y.Z`, and `release.yml` runs the stable release as a tag did:
  built as X.Y.Z, uploaded to R2, listed on the stable index after the stable environment's approval,
  then tagged `vX.Y.Z` at the merged commit with its GitHub Release. A tag no longer starts a release,
  and a version whose tag exists is not built again: the next one is a new release branch.
* **Canary** builds `main` nightly when it moved since the last successful canary, and by hand,
  instead of on every push. Beta promotion and rollback are unchanged.
* Requiring pull requests and the `ci` check on `release/**` is a branch protection rule a
  maintainer sets in GitHub; the repository cannot hold it.

### Consequences

* Good, because a pull request needs one Linux run, and a busy Windows runner holds back a release
  only.
* Good, because a release is reviewed like any change, and its checks are on the pull request.
* Bad, because a change that breaks only macOS or Windows is found when the release pull request is
  opened, days after it merged, and is fixed on `main` before the release.
* Bad, because canary is up to a day behind `main` unless someone runs it by hand.
* Bad, because a fix for a released version needs a new release branch and version; `release/vX.Y.Z`
  never builds twice.

## More Information

Issue #400. Amends ADR 0015 (every gate on every pull request) and ADR 0054 (stable from a tag, canary
on every push). Workflows: `.github/workflows/{ci,release,release-dry-run,canary}.yml`; tests:
`scripts/ci-workflows.test.mjs`. `docs/qa/TESTING.md` says which change runs what. No section of
`docs/ko/desk-structure.md` changes; `docs/ko/updater-requirements.md` still describes tag releases
and is source material.
