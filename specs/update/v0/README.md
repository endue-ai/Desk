# Desk update v0

The documents Desk's updater reads from the release origin (Cloudflare R2, ADR 0054). Static files
only: every decision is made on the device. `index.schema.json` is a channel's index, and
`release.schema.json` is one build's manifest. v0 may break on any minor release (ADR 0004).

| Path on the origin | What it is |
| --- | --- |
| `desk/channels/<channel>/index.json` (+ `.sig`) | `ReleaseIndex`: the builds on `canary`, `beta` or `stable`, newest first, with a `serial` every write raises |
| `desk/releases/<version>/release.json` (+ `.sig`) | `ReleaseManifest`: the Tauri updater's static format plus a `desk` block of per-target `sha256` and `size` |
| `desk/releases/<version>/<artifact>` (+ `.sig`) | The updater artifact of a target, as `platforms.<target>.url` names it |

**Signatures.** One minisign key (`tauri signer generate`) signs the index, the manifests and the
artifacts. A `.sig` file and a `signature` field hold the same text: the base64 of a minisign
signature file whose trusted comment names the signed version (`version:<v>`), as `tauri signer sign`
writes it. A desk checks the signature before it reads a document.

**Upload order.** Artifacts and their `.sig` go first, then `release.json`, then the index. A listed
build therefore always has its files. `releases/*` never change once written. Taking a build down
removes its listing and leaves its files.

**Decisions.** A desk at version `current`, running as `targets` (most specific first), chooses:

1. Candidates are the listings newer than `current` (SemVer precedence) that name one of its targets.
2. The newest candidate whose `minFrom` is at or below `current` is next. A newer candidate waits for
   the check after the restart, so the desk walks the update path itself.
3. A listing with `rollout` below 100 is seen only when this desk's bucket for its version is below
   `rollout`. The bucket is the first two bytes of `sha256(salt ‖ version)`, read as a big-endian u16,
   modulo 100. The salt is random, made once per install, and never leaves the device.
4. Never a downgrade, and never the same version again.
5. A staged build stays only while it is still next. It is dropped when the index no longer lists it,
   and replaced when a newer build is next.

An index served for another channel is refused, and so is one whose `serial` is below one already seen.

`vectors/` holds valid and invalid documents for the contract tests. `decisions/` holds one case per
rule: the running version, the targets, the salt, the index and the staged build in, and the next
build and the staged build's fate out, with the expected bucket of every listed version.
