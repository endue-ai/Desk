---
status: accepted
date: 2026-11-02
decision-makers: Team endue
---

# Releases live on Cloudflare R2, and the updater stages the next build and applies it on request

## Context and Problem Statement

Desk has no updater: version `0.0.0`, no release workflow, no signing (threat model, "The updater").
The design (`docs/ko/desk-structure.md`, "GitHub 와 오픈소스 뼈대") planned canary, beta and stable channels
with the updater manifest published to GitHub Releases. Installed desks need to move to the next build
with one action from the person, and the publishing target is now Cloudflare R2. Where do releases
live, how does a desk decide which build is next and when, and who decides when it switches?

## Decision Drivers

* The person learns one thing: "Restart to update". Nothing changes under them while they work
* Installed bytes are signed bytes; metadata is signed too, so a stale or crafted index cannot roll a
  desk back or freeze it
* No server: static files only, and every decision (channel, version, path, rollout) is made on the device
* No telemetry (promise 7): the check carries no identifier, and can be turned off entirely
* Reuse `tauri-plugin-updater` for download, signature verification and the per-OS install, which are
  the parts that are easy to get wrong

## Considered Options

* R2 holds static manifests and artifacts; a `desk-update` crate picks the next build from a signed
  channel index, downloads it at once, keeps it on disk, and installs it only on `update.apply`
* GitHub Releases as the origin, with the plugin's `latest.json` and `download_and_install` on check
* A dynamic update server that answers each desk with its next build (Omaha style)
* Install silently on quit or at the next start, with no action from the person

## Decision Outcome

Chosen option: "R2, a signed channel index, and a staging updater", because static files on R2 need
no server to secure, the index gives the device everything it needs to decide (version order,
`minFrom` stepping stones, `rollout`, available targets), and staging first keeps the switch in the
person's hands while removing the wait.

* **Layout.** `desk/channels/<channel>/index.json` (+ `.sig`) lists the builds on that channel;
  `desk/releases/<version>/release.json` (+ `.sig`) is the Tauri static manifest plus a `desk` block
  (`commit`, `minFrom`, per-target `sha256` and `size`); artifacts and their `.sig` sit beside it.
  Uploads go artifacts → manifest → index, so a listed build always has its files.
* **Policy on the device** (`crates/desk-update`, no Tauri): candidates are listed builds newer than
  the running one for the running target; a build whose `minFrom` is above the running version is
  reached through the newest build whose `minFrom` is not; `rollout` is a local bucket from a salt
  that never leaves the device; never a downgrade; a staged build that the index no longer lists is
  discarded. Checks run 30 s after `desk_ready`, every 4 h, and on `update.check`.
* **Stage, then apply.** The next build downloads at once (plugin `download`, which verifies the
  minisign signature), is compared with the manifest's `sha256` and kept under `<data>/updates/`.
  `update.apply` re-verifies the file (the plugin's `install` does not) and installs it: the `.app`
  bundle is replaced on macOS, NSIS runs `/UPDATE /P` per user on Windows, AppImage is rewritten in
  place and `.deb`/`.rpm` go through `pkexec` on Linux.
* **One key, embedded at build time.** Index, manifests and artifacts are signed with the updater key
  (`signing` environment). The release workflows pass the public key (repository variable
  `DESK_UPDATER_PUBKEY`) into the build; a build without it does not update itself and answers
  `unsupported`. Each artifact's signature must name its version (the trusted comment the Tauri CLI
  writes), and an index older than one already seen is refused.
* **Contract.** Bridge namespace `update.*` (`status`, `check`, `download`, `apply`, event
  `update.changed`) under one permission `update:manage`, granted to the runtime and the CLI only.
  Settings `desk.update.channel`, `desk.update.auto`, `desk.update.check` in init.yaml.
* **Channels are indexes, not version strings.** `main` builds are `<next>-pre.<run>`; promotion to
  beta lists the same artifact; a tag `v*` builds stable. Rollback removes a build from an index;
  recovery is roll-forward.

Decided with the person on 2026-11-02:

* **No macOS universal build.** `darwin-aarch64` and `darwin-x86_64` are built, signed and published
  separately: one more artifact, half the download.
* **Release notes live on GitHub.** A tag gets a GitHub Release with generated notes and links to R2,
  without binaries; a canary or beta build's notes are its commit page. `release.json` `notes` points
  there.
* **Canary builds are kept two weeks.** Each canary run unlists canary builds older than 14 days and
  deletes their files unless beta or stable lists them.
* **Applying stays with the person.** `update:manage` goes to the runtime and the CLI only. Agents and
  plugins may read the status (`update.changed` through `events.subscribe`) and ask for a check; when a
  caller other than the person invokes the runtime's `desk.update.apply`, the runtime asks the person
  first. The CLI is the same OS user's hand (ADR 0030) and is not asked.

### Consequences

* Good, because a desk is ready to switch the moment the person asks, and never switches on its own.
* Good, because a compromised or stale origin can neither downgrade nor freeze a desk: metadata is
  signed, versions only go up, and an unlisted build is thrown away.
* Good, because the plugin's install paths and signature format are reused unchanged; Desk adds
  only policy and staging, which are plain Rust with tests.
* Bad, because applying after a restart needs one small network fetch (the plugin's `Update` object
  cannot be built from outside, so it is rebuilt from the release manifest), so a desk that went
  offline across a restart cannot apply the build it holds until it is back online. Within one session
  the handle made while staging is reused and no fetch is needed.
* Bad, because `.deb`/`.rpm` updates ask for a password once (pkexec); the password-free path on
  Linux is the AppImage.
* Bad, because one key signs everything; rotating it takes two releases (a build carrying the new
  public key, signed with the old key, then the switch).
* Bad, because nothing is published until people provision the R2 bucket, the updater key and the
  Apple and Windows certificates; until then the workflows build and skip publishing.

## More Information

Design: `docs/ko/updater-requirements.md` (requirements UPD-01 to UPD-19, the R2 layout, the manifest
and index formats, the decision rules and the release pipeline). Requirements SYS-09 and OPS-01 in
`docs/ko/desk-requirements.md`. Related: ADR 0003 (the runtime ships with the app, so one artifact
updates core, bridge and runtime together), ADR 0007 (crash signatures gate beta promotion), ADR 0031
(settings layers), ADR 0030 (the CLI's grants). `docs/ko/desk-structure.md` "GitHub 와 오픈소스 뼈대"
must change its publishing target from GitHub Releases to R2 when this is accepted; the threat model's
"The updater" section closes its gaps with the issues this ADR's tasks open.
