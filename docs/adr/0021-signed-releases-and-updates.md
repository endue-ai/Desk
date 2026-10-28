---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Signed releases from tags, smoke-tested, with updates from the GitHub Release

## Context and Problem Statement

Desk had no release workflow: nothing was signed or notarized, so macOS would refuse the app and
Windows would warn about it, and installed apps could not update. The design (`docs/ko/desk-structure.md`,
"GitHub 와 오픈소스 뼈대") asks for `release.yml`: a `v*` tag builds three OSes, signs and notarizes,
smoke-tests the installs, writes the updater manifest and publishes, with signing keys in a protected
environment that AI tokens cannot reach. How exactly?

## Decision Drivers

* Keys never leave protected environments; nothing runs on pull requests
* A release that does not install and start is never published
* Updates must be verified by the app itself, not only by TLS
* As little release machinery as possible inside the repository

## Considered Options

* Our own workflow calling the Tauri CLI, with build, smoke and publish as separate jobs
* `tauri-apps/tauri-action`, which builds, signs and publishes in one job
* Windows signing: Azure Artifact Signing, or a certificate file in secrets

## Decision Outcome

Chosen option: "Our own workflow calling the Tauri CLI", with Azure Artifact Signing for Windows.

* `build` runs in the `signing` environment, one job per target. The Tauri CLI signs: Developer ID and
  notarization (App Store Connect API key) on macOS with the hardened runtime and the entitlements of
  `docs/os-permissions.md`, `trusted-signing-cli` on Windows, and updater signatures on every bundle.
* `smoke` verifies signatures (codesign, spctl, stapler; Authenticode), installs and launches each OS's
  package, and waits for the runtime's `desk ready` line. Publishing waits for every smoke job.
* `publish` runs in the `stable` environment with the only `contents: write` token. Assets get stable
  names (`endue-desk_<version>_<platform><ext>`) and `latest.json` lists the updater bundles with their
  signatures (`scripts/release-assets.mjs`).
* The app's `updater` feature is on only in release builds, with the public key and endpoint from
  `just release-config`; it checks after start and asks before installing. `requireSignedVersion`
  binds each artifact to its version, so an old signed build cannot be served as a new one.
* Certificate files in secrets were rejected for Windows: code-signing keys now have to live in
  hardware or a cloud HSM, which Artifact Signing provides.

### Consequences

* Good, because every published build was signed, notarized and started once on a clean runner.
* Good, because the build jobs hold signing keys but cannot publish, and the publish job can publish
  but holds no keys.
* Bad, because releases depend on four outside accounts (Apple Developer, App Store Connect, Azure,
  GitHub environments) that maintainers must set up before the first tag (`docs/release.md`).
* Bad, because canary, beta promotion, release-please and rollback are still to come; versions are
  bumped by hand until then.

## More Information

`.github/workflows/release.yml`, `scripts/release-config.mjs`, `scripts/release-assets.mjs`,
`e2e/smoke/`, `apps/desk/src-tauri/src/updates.rs`, `docs/release.md`.
