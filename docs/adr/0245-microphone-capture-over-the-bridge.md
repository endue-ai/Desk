---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

# The microphone's audio crosses the bridge, and the chrome shows and stops every capture

## Context and Problem Statement

`specs/bridge/v0` declared `audio.capture.start` and `audio.capture.stop`, and its README said that
"audio itself never leaves the core through the bridge in v0": a capture was only for the wake word
(`audio.wake`). The core answered both with `unsupported`, and `desk-sys` had a cpal input that
nothing used. Eris's ear (`packages/runtime/src/eris/ear.ts`) listens with Web Audio and Web Speech,
which may not hear inside CEF. Issue #311 asks for capture that a plugin and Eris can use, a chrome
that shows while anything captures and lets the person stop it, and tests on a fake device.

## Decision Drivers

* A plugin, and Eris without Web Speech, need the audio itself, not only a wake word
* The person sees every capture, whoever started it, and can stop it from the chrome
* A capture ends with whatever let it run: its plugin, its grant, its surfaces
* No test opens a real microphone

## Considered Options

* Frames over the bridge: `audio.frame` (20 ms of base64 LINEAR16 and its level) to the caller,
  `audio.ended` with a reason, `audio.capturing` to the runtime
* A level-only event, with the samples behind a separate opt-in
* Keep audio in the core and give the runtime only a level through `ShellBridge.audio.levels`

## Decision Outcome

Chosen option: "frames over the bridge", accepted by the person on #311 on 2026-11-15, because it is
what `desk-sys` already produces and what a recogniser needs, at 50 small events a second.

* **audio.frame** goes only to the capture's caller: `captureId`, `atMs`, `sampleRate`, `pcm` (mono
  signed 16-bit little-endian, base64), `rmsDb`, `peakDb`.
* **audio.ended** comes once, last: `stopped`, `stopped_by_person` (the runtime stopped another
  caller's capture), `plugin_stopped`, `surface_closed` (the caller's last open surface closed),
  `revoked`, or `device` with the error's message.
* **audio.capturing** goes only to the runtime: every capture in force and its caller, on each change.
  The runtime may stop any capture; another caller's id is `not_found` to everyone else.
* **Asking.** A caller without a grant is asked once through the existing prompt (`check_or_ask`, as
  perm.request asks), then the OS (`request_access`) if it was never asked; `NSMicrophoneUsageDescription`
  is in the macOS Info.plist. desk-boot injects `desk_sys::audio::os()`; tests inject `FakeInput`.
* **The chrome.** The rail's Listen button (composition D, #291) is on with a dot while anything
  captures, names who listens, and stops every capture when pressed.
* **Eris.** Without `SpeechRecognition` her ear captures through the bridge and draws the level from
  each frame's spectrum. `specs/brain` has no speech-to-text, so she hears no words that way yet.
* **Wake word.** `wakeWord: true` answers `unsupported` until the core has a wake-word engine.

### Consequences

* Good, because a plugin can capture with one permission, and the person always sees and can stop it.
* Good, because the core's tests run the cpal pipeline on a fake input, never a microphone.
* Bad, because 20 ms frames cost about 50 events a second for each capture on the bridge.
* Bad, because without Web Speech the ear shows the level but hears no words: transcription and the
  wake word are follow-ups.
* Bad, because Windows and Linux capture is tested only through the fake: cpal serves them, but no
  real device there was tried for this change.

## More Information

Core: `crates/desk-core/src/core_audio.rs`, `crates/desk-core/tests/audio.rs`. Spec:
`specs/bridge/v0/audio.schema.json` and its vectors. Runtime: `packages/runtime/src/eris/ear-capture.ts`,
`packages/runtime/src/shell/mic.ts`, `apps/desk/src/shell-bridge.ts`. The input itself:
`crates/desk-sys/src/audio.rs`. Follow-ups: speech-to-text without Web Speech, and the wake word.
