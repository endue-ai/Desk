//! The smallest logic plugin. On start it registers its one command, reads hello.txt from its own
//! folder, counts its runs in the store (which outlives the instance, so a reload keeps counting),
//! and shows both as a notification. It answers its command with a greeting and writes one log
//! line for each call and each event. Everything it touches goes through `desk:host` (specs/wit).

wit_bindgen::generate!({ path: "../../specs/wit", world: "plugin" });

use desk::host::types::ErrorCode;
use desk::host::{cmd, fs, log, store, ui};
use serde_json::Value;

const GREET: &str = "example.hello-wasm.greet";
const GREET_ARGS: &str =
    r#"{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}"#;

struct Hello;

impl Guest for Hello {
    fn start() -> Result<(), Error> {
        cmd::register(&cmd::Command {
            id: GREET.into(),
            title: "Say hello".into(),
            description: Some("Answers with a greeting for the given name.".into()),
            keywords: vec![],
            args_schema: Some(GREET_ARGS.into()),
            when: None,
        })?;
        let text = fs::read("${plugin}/hello.txt")?;
        let runs = store::get("runs")?
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;
        store::set("runs", &runs.to_string())?;
        let body = format!("{} (run {runs})", String::from_utf8_lossy(&text).trim());
        ui::notify("Hello from Wasm", Some(&body), ui::NotifyLevel::Info)
    }

    fn on_command(
        invocation_id: String,
        command_id: String,
        args_json: String,
    ) -> Result<(), Error> {
        if command_id != GREET {
            return Err(Error {
                code: ErrorCode::NotFound,
                message: format!("hello-wasm provides no command {command_id}"),
            });
        }
        let args: Value = serde_json::from_str(&args_json).unwrap_or_default();
        let name = args["name"].as_str().unwrap_or("world");
        let greeting = Value::from(format!("Hello, {name}!")).to_string();
        cmd::answer(&invocation_id, Ok(&greeting))?;
        log::write(log::Level::Info, &format!("greeted {name}"), None)
    }

    fn on_event(name: String, data_json: String) -> Result<(), Error> {
        log::write(log::Level::Info, &format!("event {name}"), Some(&data_json))
    }
}

export!(Hello);
