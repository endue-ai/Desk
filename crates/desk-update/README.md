# desk-update

The decisions of Desk's updater (ADR 0054, `docs/ko/updater-requirements.md`), apart from Tauri: read
the channel's signed index from the release origin, choose the next build on the device, download and
verify it at once, keep it on disk, and install it only when asked.

## Public API

- `Updater::new(Config, Transport, Installer, Prefs)`: the state machine (idle, checking, up-to-date,
  available, downloading, staged, applying, failed). `check`, `download` and `apply` run in the
  background and answer at once; `*_now` run on the caller's thread. `start` checks by the schedule;
  `listen` hears every `Status`.
- `Transport` (fetch documents, download artifacts with progress) and `Installer` (install the staged
  bytes and restart) are what the app supplies.
- `policy::choose`: newer, for this target, `minFrom` met, inside the rollout, never a downgrade.
- `verify::verify`: minisign in the Tauri encoding, with the version an artifact was signed for.
- `stage::Stage`: `<data>/updates`, one staged build, the rollout salt and the index serials seen.
- `manifest`: `index.json` and `release.json`; `schedule`: 30 s, then 4 h ± 10 %, backing off.
- `https::Https` (feature `https`): the `Transport` over ureq and rustls, bounded per read, one user
  agent for every desk.

## Test

```bash
cargo test -p desk-update
```

The tests sign their data with keys made at test time (`minisign`, a dev-dependency) and run the
updater over a fake origin and a fake installer.
