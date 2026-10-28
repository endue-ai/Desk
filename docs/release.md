# Releasing

A release is one decision by a person: merge the release PR, which tags `v<version>`. The tag runs
`.github/workflows/release.yml` (ADR 0021):

1. **preflight**: the tag matches `apps/desk/src-tauri/tauri.conf.json`'s `version`, and
   `just os-declarations` passes (`docs/os-permissions.md`).
2. **build** (environment `signing`), one job per target: `aarch64-apple-darwin`, `x86_64-apple-darwin`,
   `x86_64-pc-windows-msvc`, `x86_64-unknown-linux-gnu`. `tauri build --features updater` with the
   configuration from `just release-config`: updater signatures on every bundle, Developer ID signing
   and notarization on macOS, Artifact Signing on Windows.
3. **smoke**, on clean runners: macOS checks the signature, hardened runtime, entitlements, Gatekeeper
   and the stapled ticket, then launches the app; Windows checks Authenticode on the installers, installs
   silently and launches; Linux installs the `.deb` and launches. Launching means the runtime's
   `desk ready` line within 90 seconds (`e2e/smoke/`).
4. **publish** (environment `stable`): `just release-assets` names every bundle
   `endue-desk_<version>_<platform><ext>` and writes `latest.json`; the GitHub Release gets both.

Installed apps check `https://github.com/<repo>/releases/latest/download/latest.json` after they start,
and ask before installing. Updates are verified with the updater public key built into the app, and
each artifact must have been signed for the version the manifest announces (`requireSignedVersion`).

## Settings (maintainers)

Environment `signing` (tags only, no reviewers; AI tokens cannot reach it):

| Name | Kind | What |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | Updater key pair's private half (`pnpm --filter @endue-ai/desk-app tauri signer generate`) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | secret | Developer ID Application certificate as base64 `.p12` |
| `APPLE_SIGNING_IDENTITY` | variable | `Developer ID Application: <Team> (<TEAMID>)` |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | secret | App Store Connect API key for notarization: issuer id, key id, the `.p8` contents |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | secret | Service principal allowed to sign with the Artifact Signing profile |
| `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE` | variable | Artifact Signing endpoint, account and certificate profile |

Repository variable `DESK_UPDATER_PUBKEY`: the updater key pair's public half (not secret).

Environment `stable`: limited to `v*` tags; it holds nothing but gates the publish step.

Changing the updater key strands every installed app on its current version: they can only verify
updates signed with the key they were built with.

## Not yet

`canary.yml`, `promote.yml`, `release-please.yml` and `rollback.yml` from the design
(`docs/ko/desk-structure.md`) are not in place; until then the version is bumped by hand in
`tauri.conf.json` (and the workspace `Cargo.toml`) in the PR that is tagged.
