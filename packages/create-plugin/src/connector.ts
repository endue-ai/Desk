// The files of a new Wasm connector in Rust, in the same layout as examples/plugin-hello-connector.

import type { PluginManifest } from "@endue-ai/bridge";
import connectorWit from "../../../specs/wit/desk-connector.wit?raw";
import hostWit from "../../../specs/wit/desk-host.wit?raw";
import type { PluginOptions } from "./template";

/** The wit-bindgen version examples/plugin-hello-connector builds with. */
const WIT_BINDGEN = "0.63";

/** Every file of the connector folder, keyed by its path relative to the folder. */
export function renderConnector(options: PluginOptions): Record<string, string> {
  // The id's last segment names the Cargo package; the library, and so the component, has `_`.
  const pkg = options.id.slice(options.id.lastIndexOf(".") + 1);
  const lib = pkg.replaceAll("-", "_");
  const entry = `build/wasm32-wasip2/release/${lib}.wasm`;
  return {
    "plugin.json": manifest(options, entry),
    "README.md": readme(options, entry),
    "Cargo.toml": cargoToml(options, pkg, lib),
    ".cargo/config.toml": CARGO_CONFIG,
    ".gitignore": gitignore(lib),
    "src/lib.rs": libRs(options),
    "wit/desk-host.wit": hostWit,
    "wit/desk-connector.wit": connectorWit,
  };
}

function manifest({ id, name, description }: PluginOptions, entry: string): string {
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "connector",
    entry,
    ...(description === undefined ? {} : { description }),
    connector: {
      binding: "wasm",
      auth: { kind: "none" },
      resources: [{ kind: "note" }],
      sync: { mode: "pull", intervalSeconds: 900 },
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

const FENCE = "```";

function readme({ id, name, description }: PluginOptions, entry: string): string {
  return [
    `# ${name}`,
    "",
    description ?? "A Desk connector.",
    "",
    `Id: \`${id}\`. Ids are lowercase and reverse-domain; use a domain you own before you publish.`,
    "",
    "## Build it",
    "",
    "Once, add the Wasm target; then build in this folder:",
    "",
    `${FENCE}bash`,
    "rustup target add wasm32-wasip2",
    "cargo build --release",
    FENCE,
    "",
    `The component lands in \`${entry}\`, where \`plugin.json\` points.`,
    "",
    "## What it does",
    "",
    "`src/lib.rs` implements the `desk:connector` world in `wit/` (`specs/wit` of the Desk repository).",
    "Desk calls `sync` every `sync.intervalSeconds` and stamps each item's `source`; this one returns",
    "one note the first time and nothing after. `query` and `act` answer `unsupported`, `status` is ok.",
    "Return your app's items instead, declare what each instance needs under",
    "`connector.instanceSettings`, and every permission the code uses under `permissions`.",
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): kind `connector`, binding `wasm`, one `note` resource, pull |",
    "| `src/lib.rs` | The connector: `sync`, `query`, `act` and `status` |",
    "| `wit/` | The WIT it builds to: `desk:host` and `desk:connector` |",
    "| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/` |",
    "",
    "## Check it",
    "",
    `${FENCE}bash`,
    "cargo run -p desk-cli -- plugin validate /path/to/this/folder",
    FENCE,
    "",
  ].join("\n");
}

function cargoToml({ name, description }: PluginOptions, pkg: string, lib: string): string {
  return `[package]
name = "${pkg}"
description = ${JSON.stringify(description ?? name)}
version = "0.1.0"
edition = "2024"
publish = false

[lib]
name = "${lib}"
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "${WIT_BINDGEN}"

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
panic = "abort"
strip = true

# Its own workspace, so it builds alone wherever the folder lives.
[workspace]
`;
}

const CARGO_CONFIG = `# The README's build command (\`cargo build --release\`) in this folder builds the component
# plugin.json's entry names.
[build]
target = "wasm32-wasip2"
target-dir = "build"
`;

function gitignore(lib: string): string {
  return `# Everything cargo builds except the component the entry names, so the folder installs as it is.
/build/*
!/build/wasm32-wasip2/
/build/wasm32-wasip2/*
!/build/wasm32-wasip2/release/
/build/wasm32-wasip2/release/*
!/build/wasm32-wasip2/release/${lib}.wasm
`;
}

function libRs({ name }: PluginOptions): string {
  return `//! ${name.replaceAll(/\s+/g, " ")}: a Desk connector, a Wasm component of the \`desk:connector\` world (\`wit/\`). Desk
//! calls \`sync\` on the manifest's interval and stamps each item's \`source\`.

wit_bindgen::generate!({
    path: "wit",
    world: "desk:connector/connector",
    generate_all,
});

use desk::connector::types::{Item, ItemChange, ItemKind};
use desk::host::types::ErrorCode;

struct Hello;

impl Guest for Hello {
    /// The changes since \`cursor\`: one note the first time, nothing after. Return your app's items.
    fn sync(_instance: Instance, cursor: Option<String>) -> Result<SyncResult, Error> {
        let mut changes = Vec::new();
        if cursor.is_none() {
            changes.push(ItemChange::Upserted(Item {
                id: "hello".into(),
                kind: ItemKind::Note,
                title: ${rustString(`Hello from ${name}`)}.into(),
                updated_at: "2026-01-01T00:00:00Z".into(),
                created_at: None,
                deep_link: None,
                body: Some("Replace this note with your app's data.".into()),
                details: "{}".into(),
                raw: None,
            }));
        }
        Ok(SyncResult {
            changes,
            cursor: Some("1".into()),
            done: true,
        })
    }

    fn query(_instance: Instance, _query: ItemQuery) -> Result<ItemPage, Error> {
        Err(unsupported("this connector has no live query"))
    }

    fn act(_instance: Instance, action: String, _args_json: String) -> Result<String, Error> {
        Err(unsupported(&format!("this connector has no action {action}")))
    }

    fn status(_instance: Instance) -> Result<(), Error> {
        Ok(())
    }
}

fn unsupported(message: &str) -> Error {
    Error {
        code: ErrorCode::Unsupported,
        message: message.to_owned(),
    }
}

export!(Hello);
`;
}

/** `text` as a Rust string literal. */
function rustString(text: string): string {
  const escaped = [...text]
    .map((c) => {
      if (c === "\\" || c === '"') return `\\${c}`;
      const code = c.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? `\\u{${code.toString(16)}}` : c;
    })
    .join("");
  return `"${escaped}"`;
}
