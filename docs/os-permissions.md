# OS permissions

Desk asks the person before it touches anything (the core's permission engine, ADR 0016). The
operating system asks too, and it only lets an app ask for what the app declared when it was built.
This page lists what Desk declares, where, and which feature needs it. `just os-declarations` checks
the declarations; the release workflow runs it before bundling.

| OS | Feature | Declared in | What the person sees |
| --- | --- | --- | --- |
| macOS | Microphone (`audio.capture`, "Hey Eris") | `NSMicrophoneUsageDescription` in `apps/desk/src-tauri/Info.plist`; `com.apple.security.device.audio-input` in `Entitlements.plist` | The system microphone prompt with Desk's sentence, the first time a capture opens |
| macOS | Tool VM (`desk-vm`, Virtualization.framework, ADR 0002) | `com.apple.security.virtualization` in `Entitlements.plist` | Nothing; the VM is Desk's own |
| macOS | All of the above under the hardened runtime | `bundle.macOS.hardenedRuntime` (on) in `tauri.conf.json` | Required for notarization |
| Windows | Microphone | Nothing to declare for MSI and NSIS installs | Settings > Privacy > Microphone: "Let desktop apps access your microphone" must be on |
| Windows | Tool VM (WSL2) | Nothing to declare | WSL must be installed; Desk will say so when a tool plugin needs it |
| Linux | Microphone (ALSA, PulseAudio or PipeWire through it) | `bundle.linux.deb.depends` (`libasound2t64 \| libasound2`) and `rpm.depends` (`alsa-lib`) in `tauri.conf.json` | Nothing; AppImage bundles the library |
| Linux | Tool VM (KVM) | Nothing to declare | The person needs access to `/dev/kvm` (usually the `kvm` group) |

Without the macOS entries the system ends the app the moment it opens the microphone (a missing usage
sentence) or refuses the capability silently (a missing entitlement), so every feature that needs a new
OS capability adds its declaration and its line in `scripts/os-declarations.mjs` in the same change.

Signing and notarization, which make these declarations count, are in `.github/workflows/release.yml`.
