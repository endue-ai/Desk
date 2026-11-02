// The files of a new logic plugin in Rust: a Wasm component of the `desk:host` world, laid out
// like examples/plugin-hello-wasm but carrying its WIT, so it builds wherever the folder lives.

import type { PluginManifest } from "@endue-ai/bridge";
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

/** Every file of the logic plugin's folder, keyed by its path relative to the folder. */
export function renderLogic(options: PluginOptions): Record<string, string> {
  const crate = crateOf(options.id);
  return {
    "plugin.json": manifest(options, crate.entry),
    "README.md": readme(options, crate.entry),
    "Cargo.toml": cargoToml(options, crate, ['serde_json = "1"']),
    ".cargo/config.toml": CARGO_CONFIG,
    ".gitignore": gitignore(crate.lib),
    "src/lib.rs": libRs(options),
    "tests/greet.test.json": greetTest(options),
    "wit/desk-host.wit": hostWit,
  };
}

function manifest({ id, name, description }: PluginOptions, entry: string): string {
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "logic",
    entry,
    ...(description === undefined ? {} : { description }),
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Start, then greet Ada, with the greeting setting answered by the script. */
function greetTest({ id }: PluginOptions): string {
  const command = `${id}.greet`;
  const value = {
    steps: ["start", { command: { id: command, args: { name: "Ada" } } }],
    answers: [{ method: "settings.get", params: { key: "greeting" }, result: "Hi" }],
    expect: {
      calls: [
        { method: "cmd.register", params: { id: command } },
        { method: "cmd.answer", params: { result: "Hi, Ada!" } },
      ],
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(options: PluginOptions, entry: string): string {
  const command = `${options.id}.greet`;
  return [
    ...heading(options, "A Desk logic plugin."),
    ...buildSection(entry),
    "## What it does",
    "",
    "`src/lib.rs` implements the `plugin` world of `desk:host` in `wit/` (`specs/wit` of the Desk",
    `repository). On \`start\` it registers \`${command} { name }\`; \`on-command\` answers it`,
    "through `cmd.answer` with a greeting whose first word is the plugin's `greeting` setting",
    '("Hello" until one is set). Every capability goes through `desk:host`; declare each permission',
    "the code needs under `permissions` in `plugin.json` (this one needs none).",
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): kind `logic`, the component as its entry |",
    "| `src/lib.rs` | The plugin: `start`, `on_command` and `on_event` |",
    "| `tests/greet.test.json` | Its test: start, greet, and the calls that must follow |",
    "| `wit/` | The WIT it builds to: `desk:host` |",
    "| `.cargo/config.toml` | Builds for `wasm32-wasip2` into `build/` |",
    "",
    ...checkSection(
      [
        "`plugin test` runs `tests/*.test.json` on a scripted desk: each takes its `steps` (`start`,",
        "a `command`, an `event`), answers the plugin's calls from `answers`, and checks that the",
        "calls under `expect` were made in that order. Build the component first.",
      ].join("\n"),
    ),
  ].join("\n");
}

function libRs({ id, name }: PluginOptions): string {
  return `//! ${oneLine(name)}: a Desk logic plugin, a Wasm component of the \`desk:host\` world (\`wit/\`). On
//! start it registers its command; it answers it with a greeting whose first word is its
//! \`greeting\` setting, "Hello" until one is set. Every capability goes through \`desk:host\`.

wit_bindgen::generate!({ path: "wit", world: "plugin" });

use desk::host::types::ErrorCode;
use desk::host::{cmd, log, settings};
use serde_json::Value;

const GREET: &str = ${rustString(`${id}.greet`)};
const GREET_ARGS: &str =
    r#"{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}"#;

struct Logic;

impl Guest for Logic {
    /// Called after every load and reload: register the command. State that must outlive the
    /// instance goes in the store (\`store::set\`), never in statics.
    fn start() -> Result<(), Error> {
        cmd::register(&cmd::Command {
            id: GREET.into(),
            title: ${rustString(`${name}: say hello`)}.into(),
            description: Some("Answers with a greeting for the given name.".into()),
            keywords: vec![],
            args_schema: Some(GREET_ARGS.into()),
            when: None,
        })
    }

    fn on_command(
        invocation_id: String,
        command_id: String,
        args_json: String,
    ) -> Result<(), Error> {
        if command_id != GREET {
            return Err(Error {
                code: ErrorCode::NotFound,
                message: format!("this plugin provides no command {command_id}"),
            });
        }
        let args: Value = serde_json::from_str(&args_json).unwrap_or_default();
        let name = args["name"].as_str().unwrap_or("world");
        // Settings cross the WIT as JSON text: \`"Hi"\` is the string Hi.
        let word = settings::get("greeting", None)?
            .and_then(|text| serde_json::from_str::<String>(&text).ok())
            .unwrap_or_else(|| "Hello".to_owned());
        let greeting = Value::from(format!("{word}, {name}!")).to_string();
        cmd::answer(&invocation_id, Ok(&greeting))?;
        log::write(log::Level::Info, &format!("greeted {name}"), None)
    }

    fn on_event(name: String, data_json: String) -> Result<(), Error> {
        log::write(log::Level::Info, &format!("event {name}"), Some(&data_json))
    }
}

export!(Logic);
`;
}
