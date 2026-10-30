# examples

The smallest working examples. Each one runs with a single command; people writing their first plugin and
AI agents both start by copying from here.

| Example | Shows |
| --- | --- |
| `plugin-hello-ui/` | The smallest UI plugin (sandboxed iframe) |
| `plugin-hello-wasm/` | The smallest logic plugin (Wasm) |
| `plugin-hello-connector/` | The smallest connector (Wasm): markdown files in a folder as `note` items |
| `plugin-hello-mcp/` | The smallest tool plugin (MCP, inside the VM) |
| `brain-echo/` | The smallest implementation of `specs/brain`, for tests and learning |

Status: `plugin-hello-ui` runs with `just dev`, `brain-echo` with `just brain-echo` and
`plugin-hello-connector` with `cargo test -p desk-plugin-host --test hello_connector`; the others are
folders only.
