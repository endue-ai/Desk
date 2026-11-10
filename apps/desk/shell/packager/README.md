# apps/desk/shell/packager

What the CEF desk's bundles are made of (#46, ADR 0145): cargo-packager's shared config, the CEF pin,
and the macOS and Linux files the bundles carry. `scripts/cef-package.mjs` turns them into one config
per target, with the built-in plugins (git's `plugins/` without tests) beside the shell (#47);
nothing here is read at run time.

| File | Purpose |
| --- | --- |
| `cef.json` | The CEF build: exact version, each target's minimal archive (size, the CDN's SHA-1, our SHA-256), the files Windows and Linux carry beside the executable |
| `packager.json` | What every target's cargo-packager config shares: name, identifier, icons, the `.dmg`, NSIS, `.deb` and AppImage options |
| `macos/Info.plist` | Keys merged into the app's Info.plist: usage descriptions, CEF's keys, the files Finder opens with the desk |
| `macos/helper.plist` | The five helper apps' Info.plist (`endue-desk-cef Helper`, `(Alerts)`, `(GPU)`, `(Plugin)`, `(Renderer)`) |
| `macos/entitlements/` | Hardened-runtime entitlements: the app, the base Helper, GPU, Renderer; Alerts and Plugin have none |
| `linux/launcher.sh` | `/usr/bin/endue-desk-cef`: starts the desk in `/usr/lib/endue-desk-cef`, beside `libcef.so` |
| `linux/desk.desktop` | The desktop entry template |

## Public API

- `node scripts/cef-fetch.mjs --target <triple> [--out dir] [--dry-run]`: the pinned CEF, hash-checked,
  where `cef-dll-sys` reads `CEF_PATH`; prints that folder.
- `node scripts/cef-package.mjs --target <triple> --version <v> [--formats a,b] [--dry-run]`: the
  packages, in `target/packager/<triple>/bundle/{macos,dmg,nsis,msi,deb,appimage}`; `--formats app`
  makes the `.app.tar.gz` without mounting a `.dmg`.
- `scripts/cef-sign-macos.sh app|dmg <path>`: sign (ad-hoc without `APPLE_SIGNING_IDENTITY`), notarise
  and staple when the Apple credentials are set.
- `just package-shell [version]` runs all three for this machine.

## Test

```bash
node --test scripts/cef-fetch.test.mjs scripts/cef-package.test.mjs scripts/cef-sign-macos.test.mjs
just package-shell && just smoke "target/packager/aarch64-apple-darwin/bundle/dmg/endue Desk_0.0.0_aarch64.dmg"
```

Signing with a Developer ID, notarisation, Windows and Linux run where the identities and the OSes
are: the release workflow and #61.
