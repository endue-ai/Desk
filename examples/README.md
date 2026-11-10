# examples

The smallest working examples. Each one runs with a single command; people writing their first plugin and
AI agents both start by copying from here.

| Example | Shows |
| --- | --- |
| `plugin-hello-ui/` | The smallest UI plugin (sandboxed iframe) |
| `plugin-hello-wasm/` | The smallest logic plugin (Wasm) |
| `plugin-hello-connector/` | The smallest connector (Wasm): markdown files in a folder as `note` items |
| `plugin-hello-view/` | The smallest view plugin: a view as data, and a command that opens it |
| `plugin-hello-universal/` | The smallest universal view: a board in a YAML file as a kanban, list, timeline and calendar |
| `plugin-hello-mcp/` | The smallest tool plugin (MCP, inside the VM) |
| `plugin-hello-theme/` | The smallest theme with a font and a backdrop (no code, only values) |
| `plugin-native-wgpu/` | The smallest native plugin: a Rust program that draws a wgpu scene into its window (#59) |
| `brain-echo/` | The smallest implementation of `specs/brain`, for tests and learning |

Status: `plugin-hello-ui` and `plugin-hello-view` run with `just dev`, `plugin-hello-theme` with
`DESK_DEV_PLUGINS=$PWD/examples/plugin-hello-theme just dev` (`plugin-hello-universal` likewise),
`plugin-native-wgpu` with `just example plugin-native-wgpu` (macOS), `brain-echo` with
`just brain-echo` and `plugin-hello-connector` with
`cargo test -p desk-plugin-host --test hello_connector`; `plugin-hello-mcp` is a folder only. Each
plugin example carries a test that `cargo run -p desk-cli -- plugin test examples/<folder>` runs (all
but `plugin-hello-mcp`).
