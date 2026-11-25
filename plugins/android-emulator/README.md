# Android Emulator

Open **Android Emulator** from the Desk launcher. Choose a running emulator and select **Connect**,
or choose an Android Virtual Device (AVD) and select **Start device** to boot it without a separate
window. Create AVDs in Android Studio's Device Manager. The SDK needs Android Emulator and Platform-Tools.

The plugin finds `adb` and `emulator` on PATH and in the standard Android Studio SDK locations on
macOS, Linux and Windows. For another installation, enter its absolute path under **SDK directory**.

- Tap, hold or drag on the live screen. Focus it to send printable ASCII and navigation keys.
  Android's on-screen keyboard handles other scripts. The navigation bar provides Back, Home,
  Recent apps, Rotate and Pause preview.
- **Conditions** applies battery level, charger state, mobile bandwidth and latency, GPS coordinates,
  night mode and font scale. Choose a supplied preset or save your own. Empty fields keep their
  current values. A failed step reports which preceding changes were applied.
- **Apps** installs a chosen APK and lists user-installed packages. Launch an app with activity timing,
  inspect its memory usage, or read its rendered frame count, jank and frame-time percentiles.
- **Device** saves a full-resolution PNG, manages named snapshots and powers
  off the selected emulator. Restore and overwrite both ask before replacing device state.
- **Logcat** reads up to 300 recent entries at the selected minimum priority and filters them by text.

`endue.android-emulator` uses the public plugin SDK and `proc.spawn`. Device calls target one
`emulator-<port>` serial on the loopback ADB server. The preview requests one PNG at a time and
pauses when hidden. Disconnect releases the preview and input. An externally started emulator keeps
running. Desk owns the process it launches and ends it when the plugin unloads.
The open and save dialogs grant access to the selected paths. Presets stay in the plugin's store.
The underlying commands are documented in the [ADB guide](https://developer.android.com/tools/adb)
and the [emulator console reference](https://developer.android.com/studio/run/emulator-console).

```sh
pnpm exec vitest run plugins/android-emulator
just test-e2e android-emulator.spec.ts
cargo run -p desk-cli -- plugin validate plugins/android-emulator
```
