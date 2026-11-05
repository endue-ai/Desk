---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Releases come from release lines: beta carries their candidates, stable rolls out in steps

## Context and Problem Statement

Under ADR 0081, merging a pull request from `main` into `release/vX.Y.Z` builds X.Y.Z and lists it on
stable for every desk at once, built from whatever `main` held when the pull request was opened. Beta
lists a canary build three days old (ADR 0054), so the bytes on stable never ran on beta, and their
commit may never have been on canary. A branch cut from `main` has nothing to compare, so the pull
request cannot be opened; a fix needs a new branch cut by hand from the last tag. Desks honour a
`rollout` share, but every index lists 100. Where do releases come from, what runs on beta before
stable, and how fast does a stable build reach everyone?

## Decision Drivers

* The commit stable ships is the commit that ran on beta
* A fix reaches a released version without what `main` added since
* Dozens of agents keep working on one trunk (ADR 0015); a release never holds `main` back
* A bad stable build stops at a share of the desks
* No version strings in the repository (ADR 0054): the build writes them

## Considered Options

* A release line per minor version: `release/vX.Y` cut from `main`, its candidates on beta, a final
  build listed on stable in steps
* ADR 0081 as it is, with the environment and ruleset settings fixed
* GitFlow: a `develop` branch for work, `main` for releases

## Decision Outcome

Chosen option: "a release line per minor version", because it is the only one in which beta runs the
release's own commit and a fix travels by cherry-pick while `main` keeps moving.

* **Branches.** `main` stays the only trunk. `release/vX.Y` is cut by `release-cut.yml`, by default at
  the commit of the newest canary build that has been on canary three days, and carries every
  candidate and patch of X.Y. A change enters it only as a cherry-pick (`git cherry-pick -x`) of a
  commit already on `main`, through a pull request whose `ci` runs every OS. A ruleset leaves
  creating, deleting and force-pushing `release/v*` to the release app and admins.
* **Versions.** Canary builds the minor after the newest line or tag, `-pre.<run>` (`0.5.0-pre.212`
  while `release/v0.4` exists). A push to `release/vX.Y` builds `X.Y.Z-rc.<run>`, Z the patch after
  the line's newest tag. The final build is its candidate's version without the suffix.
* **Channels.** Canary lists `main` nightly. Beta lists the candidates of the lines and their finals,
  nothing else: the weekly canary-to-beta promotion (`promote.yml`) is removed, since a canary build
  of the next patch would sort above the line's candidate. Stable lists finals.
* **Final.** `release-final.yml` runs by hand: the line's newest candidate must have been on beta
  three days with no open `release-blocker` issue on the line's milestone. Its commit is built again
  as X.Y.Z (the version is in the binary and in every signature, so candidate bytes cannot be listed
  as X.Y.Z), approved in `stable`, uploaded, tagged `vX.Y.Z` with its GitHub Release, and only then
  listed: on stable at `rollout: 10`, on beta at 100.
* **Rollout.** `rollout.yml` sets a stable build's share (10, 50, 100; 0 stops new desks). Taking a
  build off stays `rollback.yml`; recovery stays roll-forward.
* **macOS and Windows** checks run nightly beside canary, so a break shows within a day.
* **Who.** The release GitHub App creates release branches and `v*` tags: the tag ruleset holds
  `GITHUB_TOKEN` back, and pushes made with it start no workflow. Cut, final and rollout run in the
  `stable` environment, so a person approves each.

### Consequences

* Good, because stable ships a commit that ran on beta for three days, and reaches a tenth of the
  desks before the rest.
* Good, because `main` never waits for a release, and a patch carries only its fixes.
* Good, because cutting, finishing and widening a release are each one dispatched, approved run.
* Bad, because every fix for an open line lands twice: on `main`, then cherry-picked.
* Bad, because the final is a second build of the candidate's commit: same commit, lockfile and
  toolchain, different bytes. The 10% step is where those bytes are tried.
* Bad, because candidate builds on R2 are never pruned yet; dropping closed lines' candidates is
  later work.
* Bad, because the settings outside the repository (environments, rulesets, the app, the secrets)
  must match the workflows; `docs/releasing.md` lists them and nothing checks them.

## More Information

Amends ADR 0081 (merging a pull request into `release/vX.Y.Z` releases it) and ADR 0054 (beta is canary
after three days; every listing at 100). Workflows `.github/workflows/{release-cut,release,
release-final,rollout,canary,ci}.yml`, scripts `scripts/release-version.mjs` and
`scripts/release-manifest.mjs`, rulesets `.github/rulesets/{release,release-tags}.json`, procedure
`docs/releasing.md`. `docs/ko/desk-structure.md` "GitHub 와 오픈소스 뼈대" and
`docs/ko/updater-requirements.md` "릴리스 파이프라인" still describe the earlier flow; they are source
material and change in a task of their own.
