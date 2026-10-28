---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# The microphone is real; the wake word sits behind an interface until an engine is chosen

## Context and Problem Statement

"Hey Eris" needs the microphone open in the core and a detector listening to it, and the bridge already
promises `audio.capture.start`/`stop` and `audio.wake` events (`specs/bridge/v0/audio.schema.json`).
Every wake-word engine needs a model trained for "Hey Eris", which does not exist yet, and the engines
differ in licence and weight: openWakeWord (Apache-2.0, ONNX runtime), Vosk keyword grammars
(Apache-2.0, a general model of about 50 MB), Porcupine (best quality, commercial licence and an access
key). Which engine ships now?

## Decision Drivers

* The capture path, permissions and events can be built and tested without an engine
* An engine and its model are a licence and size decision that should be made once, with a model
* Captured audio never leaves the core in v0
* Linux CI should not need sound libraries for crates that do not touch a device

## Considered Options

* Capture now, a `WakeDetector` trait and no engine (`NoWakeWord`); choose the engine later
* openWakeWord through ONNX now
* Vosk keyword grammar now
* Porcupine now

## Decision Outcome

Chosen option: "Capture now, an interface, no engine", chosen by the maintainers.

* desk-sys feature `audio`: `Microphone` (open a capture that hands mono samples and their rate to a
  callback until dropped), `Capture`, `WakeDetector` (`feed(samples, rate) -> Option<Detection>`) and
  `NoWakeWord`. Feature `microphone` adds `SystemMicrophone` (cpal, the default input device, on its
  own thread, downmixed to mono, at the asked rate when the device can).
* desk-core: `with_audio(microphone, detector_factory)`. `audio.capture.start` needs `audio:capture`;
  `wakeWord` needs a scope and a grant that allow it, and gives the capture its own detector.
  `audio.wake` carries the word, the confidence and `atMs` measured in captured audio, at most once
  per 1.5 s per capture. Stopping twice is fine; revoking the grant, turning the plugin off or
  quitting closes the microphone.
* The app uses `SystemMicrophone` and `NoWakeWord`: the microphone opens (after the OS asks the
  person), and `audio.wake` does not arrive until an engine lands.
* Only the app enables `microphone`, so `desk-cli` and the core build without ALSA; Linux CI jobs that
  build every feature install `libasound2-dev`.

### Consequences

* Good, because the whole path from a plugin's request to an `audio.wake` event is in place and
  tested with a recorded microphone and a scripted detector.
* Good, because the engine choice becomes one `WakeDetector` implementation and one ADR.
* Bad, because "Hey Eris" does nothing in the app until then.
* Bad, because a model for "Hey Eris" still has to be trained or bought, whatever the engine.

## More Information

`crates/desk-sys/src/audio.rs`, `crates/desk-core/src/core_audio.rs`, `crates/desk-core/tests/audio.rs`.
The microphone needs the OS declarations in `apps/desk/src-tauri` (Info.plist, entitlements).
