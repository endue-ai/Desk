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

A desk follows the channel its `desk.update.channel` names. Without it, a desk follows the channel
its build came from (`Channel::of_version` in `crates/desk-update`): a `-pre.<run>` build canary, an
`-rc.<run>` candidate beta, a final stable. A desk that installs its line's final from beta follows
stable from then on; a beta tester who wants the next line's candidates keeps
`desk.update.channel: beta`.

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

## The CEF desk

Since Stage 1 of #32 ended (#97) the desk is the CEF desk (`apps/desk/shell`, ADR 0143), and its
executable is `endue-desk`, as the Tauri desk's was. `release-build.yml` builds it and refuses any
other desk; a line builds what `.github/release-shell` names at its commit, its final what the
candidate's commit names. The file says `cef`, so canary builds the CEF desk every night `main`
moved, and the next line cut from `main` carries it to beta, then stable (ADR 0145). Lines cut before
then build the Tauri desk from their own commits. Rehearse a line with **release-dry-run** and the
update smoke below on every OS.

The CEF desk installs its own updates (#47, ADR 0147) from the same artifacts, so a Tauri desk on
beta installs the line's first CEF candidate as it installs any build, restarts into it, and from
then on updates as a CEF desk: the `.app.tar.gz` swapped in on macOS, the NSIS `-setup.exe` or the
`.msi` run silently once the desk has quit on Windows, the AppImage rewritten or the `.deb` installed
with `pkexec` on Linux. The `.msi` is an updater artifact too (`windows-x86_64-msi`), for desks
installed from it. With the Tauri desk's executable name, what a Tauri install points at finds the
CEF desk: its shortcuts, its start at login, and the program a Tauri desk restarts after the update
(`endue Desk.app/Contents/MacOS/endue-desk` on macOS, `endue-desk.exe` in the same folder on
Windows, and on Linux the `.deb`'s launcher `/usr/bin/endue-desk`, which starts the desk in
`/usr/lib/endue-desk` beside `libcef.so`). Packages carry the built-in plugins beside the shell. A CEF
candidate without `desk.update.channel` follows beta, as every `-rc` build does (above). Tauri `-rc`
desks released before #98 follow canary when no channel is set, and canary builds the CEF desk now,
so they update into CEF canary builds. Canary keeps listing its Tauri builds from before #97 until
the two-week pruning drops them, so a desk set to canary can still meet one with a newer version
until then.

Where the desk may not write its app's folder, the OS asks once (#99, ADR 0163): macOS's
administrator prompt, then a short step as root that installs its own checked copy of the archive;
`pkexec` for a `.deb`; UAC for an MSI, and for a per-user NSIS install in a folder the person may
not write. An AppImage there says how to update it by hand. A declined prompt keeps the build
staged and the update row says so once. The tests never show a real prompt, so on each OS (#61) try
it by hand: an app in `/Applications` owned by another user (`sudo chown -R root:wheel`) applied,
declined, then applied again; a `.deb` with the polkit dialog dismissed, then approved; an NSIS
install in a folder the person may not write with UAC declined (the next start says so), then
approved; an MSI with UAC approved.

The update smoke, two hops: `e2e/smoke/update-two-hops.sh <dist> <dist> <dist>`, an older build (the
last Tauri build, from a commit before Stage 1 ended, or a CEF one) and two CEF builds, each a release
folder (`release-collect.mjs`), all three built with a
throwaway key's public half (`DESK_UPDATER_PUBKEY`) and `DESK_UPDATE_URL=http://127.0.0.1:19846/desk`.
With the private half in `TAURI_SIGNING_PRIVATE_KEY` it writes and serves the R2 tree on
127.0.0.1, installs the first build with a temp HOME that follows beta, and drives `desk update
check` and `apply` until the desk on the socket reports the second, then the third version. A Tauri
debug build reads the key and the origin at run time and needs the updater plugin's
`dangerousInsecureTransportProtocol`; give it an identifier of its own where another Tauri desk runs,
since Tauri's single-instance lock is machine-wide. macOS and Linux; Windows waits for the desk
socket's Windows transport, so its hops are made from the update row by hand.

| Step | What runs | Where |
| --- | --- | --- |
| CEF | the archive `apps/desk/shell/packager/cef.json` pins, refused unless size, SHA-256 and the CDN's SHA-1 match | `node scripts/cef-fetch.mjs --target <triple>` |
| Build | `cargo build -p desk-shell --bins --release` with `CEF_PATH`; on Linux `-rpath $ORIGIN` | the workflow, `just package-shell` |
| Package | cargo-packager 0.11.8: `.app` + `.dmg`, NSIS + MSI, `.deb` + AppImage | `node scripts/cef-package.mjs` |
| Sign | macOS: framework, five helpers (each its own entitlements), app; hardened runtime; notarised and stapled; Windows: every unsigned PE file, the installers | `scripts/cef-sign-macos.sh`, `DESK_WINDOWS_SIGN_COMMAND` |
| Smoke | each package installed, its signatures checked, launched to `desk ready`, quit | `e2e/smoke/install-and-launch.sh <package>` |
| Update | the last Tauri build into a CEF build into a newer one, through `update.check` and `update.apply` | `e2e/smoke/update-two-hops.sh` (below), the signing runner (#61) |

To bump CEF: change the `cef` crate (its version names the CEF build), then every field of
`cef.json` from the CDN's `index.json` (name, size, sha1) and a SHA-256 of each archive you
downloaded; `scripts/cef-fetch.test.mjs` fails until the two agree. A CEF bump with Chromium security
fixes reaches beta within two weeks (ADR 0140).

Chromium's sandbox (ADR 0148) is on for the macOS desk: every helper enters it before it loads the
framework, through `libcef_sandbox.dylib` in the framework's `Libraries`, which the signing step signs
with the framework; `e2e/specs/sandbox.spec.ts` proves it on the development bundle. Linux and Windows
run without it (`apps/desk/shell/src/sandbox.rs`) until #61 proves each on its OS:

- **Linux.** `chrome-sandbox` (shipped beside `libcef.so`) needs root and the set-uid bit, which
  neither a cargo-packager `.deb` nor an AppImage can carry, so the desk uses the namespace sandbox,
  which needs unprivileged user namespaces; Ubuntu 23.10 and later grant them only through an
  AppArmor profile. The `.deb` installs such a profile for `/usr/lib/endue-desk/endue-desk`
  (`abi <abi/4.0>`, `userns`, `flags=(unconfined)`, as Ubuntu's own profile for Chrome) and loads it in
  `postinst`; the AppImage relies on user namespaces being open. A desk that finds neither stops
  with Chromium's "No usable sandbox" instead of running without. #61 turns `no_sandbox` to 0 on Linux
  and runs the sandbox spec there (on Linux it checks `Seccomp: 2` in `/proc/<pid>/status` and a user
  namespace apart from the desk's).
- **Windows.** CEF 156 sandboxes only an app built as a client DLL that its `bootstrap.exe` loads
  (`CEF_USE_BOOTSTRAP`): the desk becomes `endue-desk.dll` (a `cdylib`) beside `bootstrap.exe`
  renamed `endue-desk.exe`, the layout the `cef` crate's `sandbox` feature makes. NSIS and the
  MSI install both, `DESK_WINDOWS_SIGN_COMMAND` signs both, and the spec checks each renderer's
  token (restricted, at untrusted integrity) on Windows.

Sizes (CEF 156.0.26), MiB:

| Target | Download | Installed | Of which CEF | Measured |
| --- | --- | --- | --- | --- |
| darwin-aarch64 | 168 (`.app.tar.gz`; 162 before the built-in plugins, 6 compressed) | 423 (the plugins 16) | 326 (the framework) | 2026-11-10, an ad-hoc build on macOS 26.5 |
| darwin-x86_64 | not measured | not measured | 135 (the archive) | #61 |
| windows-x86_64 | not measured | not measured | 405 beside the exe | #61 |
| linux-x86_64 | not measured | not measured | 366 (`libcef.so` 265 stripped, 1,412 as shipped by CEF) | #61 |

The release workflow adds each run's numbers to its summary (`smoke-sizes.txt`).

## Settings outside the repository

Nothing below is in git, and nothing checks it; set it once, and keep it in step with the workflows.

| Where | Setting |
| --- | --- |
| Environment `signing` | deployment branches: custom, `main` and `release/v*`; no reviewers |
| Environment `stable` | deployment branches: custom, `main` and `release/v*`; required reviewers (maintainers), prevent self-review |
| `signing` secrets | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; for macOS `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` and either `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` (preferred) or `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` |
| `stable` secrets | the updater key and its password, the R2 secrets (a token of its own), `RELEASE_APP_KEY` |
| Variables | `DESK_UPDATER_PUBKEY` (repository), `RELEASE_APP_ID` (repository or `stable`); `R2_BUCKET` and `DESK_RELEASES_URL` only to change the defaults; `DESK_WINDOWS_SIGN_COMMAND` (`signing`) once Windows signing is chosen: the command that signs one file, `%1` the file, no spaces inside an argument; its credentials go in `signing` secrets and the packaging step's `env` in `release-build.yml` |
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
