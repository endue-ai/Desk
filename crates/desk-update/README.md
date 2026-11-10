# desk-update

The decisions of Desk's updater (ADR 0054), apart from Tauri: read the channel's signed index from
the release origin, choose the next build on the device, download and verify it at once, keep it on
disk, and install it only when asked; and, without Tauri, the install itself (ADR 0146).

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
- `manifest`: `index.json` and `release.json` as `specs/update/v0` defines them, read through the
  types `just codegen` writes to `src/generated.rs`; `schedule`: 30 s, then 4 h ± 10 %, backing off.
- `https::Https` (feature `https`): the `Transport` over ureq and rustls, bounded per read, one user
  agent for every desk.
- `install` (feature `install`): `Layout::of` (an `.app`, an AppImage, a `.deb`, an NSIS or MSI
  install), its targets, `install` (the `.app.tar.gz` swapped in, the AppImage renamed over, `pkexec
  dpkg -i`, the Windows installer run once the desk quits) and `PackageInstaller`, the `Installer` a
  desk without Tauri supplies with its own restart (`Relaunch`).

## Test

```bash
cargo test -p desk-update --all-features
```

The tests sign their data with keys made at test time (`minisign`, a dev-dependency) and run the
updater over a fake origin and a fake installer. `tests/vectors.rs` holds the crate to the spec's
vectors and decision cases; `tests/installer.rs` and `tests/install_packages.rs` install real
`.app.tar.gz` files made at test time, and refuse bad signatures, partial downloads and folders
the desk cannot write.
