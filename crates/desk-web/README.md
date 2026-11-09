# desk-web

What the desk's URL schemes answer, kept apart from any browser engine (ADR 0143), so the default
workspace commands test it without building CEF. The shell (`apps/desk/shell`) adapts these replies
to CEF's resource handlers.

## Public API

- `Reply`: status, MIME type, headers and body of one answer.
- `assets::serve(root, path)`: a file under `root` for a `desk-app://app/<path>` request; `index.html`
  for `/`; `404` for anything missing or outside `root`; HTML carries the shell's CSP.
- `assets::SHELL_CSP`: the shell page's Content-Security-Policy.
- `mime::for_path(path)`: the MIME type by extension.
- `plugin_host::PluginHost`: a `desk-plugin` host, shared or one plugin's surface (#36).
- `sender::Sender::of(url)`: who a frame is (the runtime, a plugin, nobody) and the caller its bridge
  calls run as (#43).
- `wire`: the text of calls, replies and events between `__deskNative` and the shell.

## Test

```bash
cargo test -p desk-web
```
