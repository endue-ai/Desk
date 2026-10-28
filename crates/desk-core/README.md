# desk-core

Kernel of endue Desk: permission engine, event bus, plugin registry, storage, brain conversation and
the bridge request handler. Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.*`, `proc.*`, `net.fetch`, `audio.*`, `perm.*`, `plugin.*`, `store.*` and `brain.say`; `ui.*`
  answers `unsupported` for now. `grant`, `revoke`, `grants_of`, `events`, `shutdown`. Work a caller
  starts (watches, processes, captures) ends when its grant is revoked or the plugin is turned off.
- Files: paths are normalised lexically, then no component below the literal part of the grant may be
  a symbolic link. `fs.write` (`createDirs` only inside the scope), `fs.watch` (coalesced).
- Processes: `proc.output` splits text only at whole characters (base64 otherwise), `proc.exit` comes
  last; later calls need a scope that still covers the command. `net.fetch` follows redirects only
  to hosts inside the scope and returns the others as results.
- Prompts: `with_prompter(impl Prompter)` shows `perm.request` as a `Prompt` (name, `describe`
  summary, cleaned reason), one at a time, only within the caller's manifest, never again after a
  refusal of the same or more (ADR 0016). `RefuseAll`, the default, refuses everything.
- Plugins: `with_plugin_store`, `install_plugin(dir, built_in)`, `install_plugins_in`, `plugins()`,
  `plugin_file`, `watch_plugins()`; built-ins get their manifest's permissions. `validate_dir`. Safe
  mode (ADR 0017): `with_safe_mode(true)`; `LaunchGuard` turns unfinished launches into a `SafeReason`.
- `PermissionEngine`: deny by default; a call passes when its scope covers the target and a grant
  covers the scope. Store: `with_store_file(path)`; one JSON value (64 KiB max) per caller and key.
- Frames (ADR 0018): `FrameRouter` sends owned events to the frame whose call started the work.
- Audio (ADR 0020): `with_audio(microphone, detector_factory)`; `audio.wake` at most once per 1.5 s.
- Brain: `with_brain(brain, BrainOptions)`, `open_session(id)`, `brain_session()`. `brain.say` streams
  `brain.turn` events; offline turns get `OFFLINE_LINE` and resume; a desk that lost its lease answers
  `READ_ONLY_LINE`. `LeaseClient`, `SessionStore`. `EventBus`: `subscribe`, `publish`.

## Testing

```bash
cargo test -p desk-core
```

Integration tests in `tests/`, among them prompt, safe_mode, files, procs, net, audio and route;
`lease.rs` and `conversation.rs` start `examples/brain-echo` (needs Node).
