//! The core's files in the app's data folder: what outlives a quit. Plugins on or off
//! (`plugins.json`), the plugins' store (`store.json`), connector secrets (`secrets.json`), the
//! person's lasting grants (`grants.json`, ADR 0029), set values (`settings.json`, ADR 0031), the log
//! (`logs/desk.log` and `desk.log.1`, ADR 0031), what each fs.write replaced (`history/`, ADR 0076)
//! and Eris's memory (`memory/`, ADR 0095).

use std::path::Path;

use desk_core::Core;

/// `core` keeping its files in `data`.
pub fn open(core: Core, data: &Path) -> Core {
    core.with_plugin_store(data.join("plugins.json"))
        .with_store_file(data.join("store.json"))
        .with_secrets_file(data.join("secrets.json"))
        .with_grant_file(data.join("grants.json"))
        .with_settings_file(data.join("settings.json"))
        .with_log_dir(data.join("logs"))
        // Every fs.write keeps the bytes it replaces here first (ADR 0076).
        .with_history_dir(data.join("history"))
        .with_memory_dir(data.join("memory"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use desk_bridge::{BridgeRequest, BridgeResponse, LogLevel, Permission};
    use desk_core::{Prompter, RefuseAll, Roots};
    use serde_json::{Value, json};

    use super::*;

    const NOTES: &str = "example.notes";

    struct Always;

    impl Prompter for Always {
        fn ask(&self, _: &str, _: &Permission, _: &str) -> bool {
            true
        }
    }

    fn folder(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("desk-app-{tag}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(dir.join("home")).unwrap();
        dir
    }

    fn call(core: &Core, caller: &str, method: &str, params: Value) -> Value {
        let request: BridgeRequest =
            serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
        match core.handle(caller, request) {
            BridgeResponse::BridgeSuccess(ok) => ok.result,
            BridgeResponse::BridgeFailure(failed) => panic!("{method}: {:?}", failed.error),
        }
    }

    #[test]
    fn an_always_grant_a_set_setting_and_the_log_outlive_the_core() {
        let dir = folder("core-files");
        let (home, data) = (dir.join("home"), dir.join("data"));
        let read = json!({ "permission": "fs:read", "paths": ["~/Pictures/2024/**"] });

        let core = open(Core::new(Roots { home: home.clone() }), &data).with_prompter(Always);
        let asked = json!({ "permission": read, "reason": "a test", "duration": "always" });
        assert_eq!(call(&core, NOTES, "perm.request", asked)["granted"], true);
        let set = json!({ "key": "view", "value": "list" });
        call(&core, NOTES, "settings.set", set);
        core.log(LogLevel::Info, "the first start", None);
        drop(core);

        let log = fs::read_to_string(data.join("logs/desk.log")).unwrap();
        assert!(log.contains("the first start"), "{log}");

        // The next start answers from the files, and the person is not asked again.
        let core = open(Core::new(Roots { home }), &data).with_prompter(RefuseAll);
        let asked = json!({ "permission": read, "reason": "a test" });
        assert_eq!(call(&core, NOTES, "perm.request", asked)["granted"], true);
        let got = call(&core, NOTES, "settings.get", json!({ "key": "view" }));
        assert_eq!(got["value"], "list");
        let _ = fs::remove_dir_all(dir);
    }
}
