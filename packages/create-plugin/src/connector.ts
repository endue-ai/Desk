// The files of a new Wasm connector in Rust, in the same layout as examples/plugin-hello-connector.

import type { PluginManifest } from "@endue-ai/bridge";
import connectorWit from "../../../specs/wit/desk-connector.wit?raw";
import hostWit from "../../../specs/wit/desk-host.wit?raw";
import { checkSection, heading } from "./readme";
import {
  buildSection,
  CARGO_CONFIG,
  cargoToml,
  crateOf,
  gitignore,
  oneLine,
  rustString,
} from "./rust";
import type { PluginOptions } from "./template";

/** Every file of the connector folder, keyed by its path relative to the folder. */
export function renderConnector(options: PluginOptions): Record<string, string> {
  const crate = crateOf(options.id);
  return {
    "plugin.json": manifest(options, crate.entry),
    "README.md": readme(options, crate.entry),
    "Cargo.toml": cargoToml(options, crate),
    ".cargo/config.toml": CARGO_CONFIG,
    ".gitignore": gitignore(crate.lib),
    "src/lib.rs": libRs(options),
    "tests/sync.test.json": syncTest(options),
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

/** One sync of a new instance on the harness, which brings the one note. */
function syncTest({ id, name }: PluginOptions): string {
  const value = {
    steps: [{ connect: { instance: "default" } }, { sync: { instance: "default" } }],
    expect: {
      items: [
        {
          id: "hello",
          kind: "note",
          title: `Hello from ${name}`,
          source: { connector: id, instance: "default" },
        },
      ],
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(options: PluginOptions, entry: string): string {
  return [
    ...heading(options, "A Desk connector."),
    ...buildSection(entry),
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
    "| `tests/sync.test.json` | Its test: connect an instance, sync it, expect the note |",
    "| `wit/` | The WIT it builds to: `desk:host` and `desk:connector` |",
    "| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/` |",
    "",
    ...checkSection(
      [
        "`plugin test` runs `tests/*.test.json` on a scripted desk: it connects an instance, syncs it",
        "and checks the items it brought. Script what your code reads (`fs.list`, `net.fetch`, ...)",
        'under `answers`, as `{ "method", "params", "result" }`. Build the component first.',
      ].join("\n"),
    ),
  ].join("\n");
}

function libRs({ name }: PluginOptions): string {
  return `//! ${oneLine(name)}: a Desk connector, a Wasm component of the \`desk:connector\` world (\`wit/\`). Desk
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
