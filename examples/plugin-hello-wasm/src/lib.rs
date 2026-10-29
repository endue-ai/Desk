//! The smallest logic plugin. On start it reads hello.txt from its own folder, counts its runs in
//! the store (which outlives the instance, so a reload keeps counting), and shows both as a
//! notification. Everything it touches goes through `desk:host` (specs/wit).

wit_bindgen::generate!({ path: "../../specs/wit", world: "plugin" });

use desk::host::{fs, store, ui};

struct Hello;

impl Guest for Hello {
    fn start() -> Result<(), Error> {
        let text = fs::read("${plugin}/hello.txt")?;
        let runs = store::get("runs")?
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
            + 1;
        store::set("runs", &runs.to_string())?;
        let body = format!("{} (run {runs})", String::from_utf8_lossy(&text).trim());
        ui::notify("Hello from Wasm", Some(&body), ui::NotifyLevel::Info)
    }
}

export!(Hello);
