# Releasing endue Desk

How a build reaches installed desks, and what a maintainer does at each step. The decisions are ADR
0054 (R2, signed indexes, the staging updater), ADR 0081 (which OS runs where) and ADR 0092 (release
lines, candidates on beta, stable in steps). Agents stop at the cherry-pick pull request: every run
below waits for a person in the `stable` environment.

## Branches and channels

`main` is the only trunk. A release line `release/vX.Y` is cut from it once per minor version and
carries every candidate and patch of X.Y. A change reaches a line only as a cherry-pick of a commit
already on `main`.

| Channel | Fed by | Version | When |
| --- | --- | --- | --- |
| canary | `main` | the next line's .0, `-pre.<run>` (`0.5.0-pre.212`) | nightly when `main` moved (`canary.yml`), or by hand |
| beta | `release/vX.Y` | `X.Y.Z-rc.<run>` (`0.4.0-rc.31`), then `X.Y.Z` | every push to the line (`release.yml`) |
| stable | the candidate three days on beta | `X.Y.Z` (`0.4.0`) | `release-final.yml`, then `rollout.yml` |

Versions live in no file: the workflows write them into the build (`scripts/release-version.mjs`).
Desks never move down, so a desk that switches from canary to stable waits for a newer stable build.

## Cut a line

1. Run **release-cut** on `main` (Actions → release-cut → Run workflow). Leave both inputs empty to cut
   the next line at the commit of the newest canary build that has been on canary three days; give a
   line (`release/v1.0`) or a `main` commit to choose.
2. Approve it in `stable`. The release app creates the branch and the milestone `vX.Y`.
3. The push starts **release**: check and unit tests on every OS, then the line's first candidate on
   beta. Its notes are the commit page.

## Fix a line

1. Merge the fix into `main` first, as any change.
2. On a branch from the line, `git cherry-pick -x <commit>` and open a pull request into
   `release/vX.Y` titled `[vX.Y] <the original title>`. Its body keeps the original `Closes #N`, so
   `scope-check` reads that issue's Scope.
3. `ci` runs every OS; the `release` ruleset asks for a review and a branch up to date with the line.
   Merging it builds the next candidate (`X.Y.Z-rc.<run>`, Z one past the line's newest tag).
4. A problem that must hold the final back gets an issue with the label `release-blocker` on the
   milestone `vX.Y`.

## Ship the final

1. Run **release-final** on the line (`gh workflow run release-final --ref release/vX.Y`). It needs the
   line's newest candidate to have been on beta three days (the `soak-days` input lowers it for an
   urgent fix) and no open `release-blocker` issue on the milestone. A newer candidate restarts the
   wait, so the final always ships the newest one.
2. It builds the candidate's commit again as `X.Y.Z`; approve the publish in `stable`.
3. The publish uploads the build (listed nowhere yet), tags `vX.Y.Z` with its GitHub Release through
   the release app, and only then lists it: on stable for 10% of the desks, on beta for all. If a step
   fails, re-run the publish job: what is done already is kept.

## Widen, stop, take off

| To | Run | Effect |
| --- | --- | --- |
| widen | **rollout** `version`, `50` then `100` | more stable desks see it; a desk's bucket never changes, so it only adds desks |
| stop | **rollout** `version`, `0` | no new desk takes it; desks that staged it keep it |
| take off | **rollback** `channel`, `version` | off the index; desks that staged it drop it; recovery is the next patch |

Suggested pace: 10% on the day of the final, 50% two days later, 100% two days after that, each step
after reading the issues filed against the version. Desks send nothing (no telemetry), so the issue
tracker is the signal.

## Settings outside the repository

Nothing below is in git, and nothing checks it; set it once, and keep it in step with the workflows.

| Where | Setting |
| --- | --- |
| Environment `signing` | deployment branches: custom, `main` and `release/v*`; no reviewers |
| Environment `stable` | deployment branches: custom, `main` and `release/v*`; required reviewers (maintainers), prevent self-review |
| `signing` secrets | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; for macOS `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` and either `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` (preferred) or `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` |
| `stable` secrets | the updater key and its password, the R2 secrets (a token of its own), `RELEASE_APP_KEY` |
| Variables | `DESK_UPDATER_PUBKEY` (repository), `RELEASE_APP_ID` (repository or `stable`); `R2_BUCKET` and `DESK_RELEASES_URL` only to change the defaults |
| Release GitHub App | owned by the organisation, installed on this repository only; permissions Contents read and write, Issues read and write, Metadata read; its private key is `RELEASE_APP_KEY` |
| Rulesets | `RELEASE_APP_ID=<id> scripts/sync-rulesets.sh` applies `.github/rulesets/`: `main`, `release` (who creates lines, review and checks on them) and `protect-release-tags` (who creates `v*`) |
| Labels | `scripts/sync-labels.sh` adds `release-blocker` |

Make the updater key with `pnpm --filter @endue-ai/desk-app exec tauri signer generate -w desk-updater.key`,
put the public key in `DESK_UPDATER_PUBKEY` and keep the private key only in the two environments. Each
R2 token is scoped to the one bucket with object read and write, so each can be revoked alone.

Windows builds are unsigned until Authenticode signing is chosen. The candidate is Azure Artifact
Signing, which accepts organisations in South Korea; wiring it is a task of its own.

## What stops a run

| Message | Why | Do |
| --- | --- | --- |
| `builds no candidate: … not set` | a secret or variable is missing in `signing` | set it, push again or re-run |
| `is not a release line` | the branch is `release/vX.Y.Z` or another name | lines are `release/vX.Y` only |
| `No candidate of … has been on beta N days` | the newest candidate is younger | wait, or lower `soak-days` |
| `Open release-blocker issues` | the milestone holds the final | close or move the issues |
| `is released already` | the tag exists | cherry-pick a fix and ship the next patch |
| `is not above every line that exists` | the line was cut before, or is older | cut the line the message names |
