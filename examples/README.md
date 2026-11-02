# examples

The smallest working examples. Each one runs with a single command; people writing their first plugin and
AI agents both start by copying from here.

| Example | Shows |
| --- | --- |
| `plugin-hello-ui/` | The smallest UI plugin (sandboxed iframe) |
| `plugin-hello-wasm/` | The smallest logic plugin (Wasm) |
| `plugin-hello-connector/` | The smallest connector (Wasm): markdown files in a folder as `note` items |
| `plugin-hello-view/` | The smallest view plugin: a view as data, and a command that opens it |
| `plugin-hello-mcp/` | The smallest tool plugin (MCP, inside the VM) |
| `brain-echo/` | The smallest implementation of `specs/brain`, for tests and learning |

Status: `plugin-hello-ui` and `plugin-hello-view` run with `just dev`, `brain-echo` with
`just brain-echo` and `plugin-hello-connector` with `cargo test -p desk-plugin-host --test
hello_connector`; `plugin-hello-mcp` is a folder only. Each plugin example carries a test that
`cargo run -p desk-cli -- plugin test examples/<folder>` runs (all but `plugin-hello-mcp`).
