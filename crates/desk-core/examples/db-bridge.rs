//! The core's db.* for tests outside Rust: the database plugin's live tests
//! (`plugins/database/tests/core-bridge.ts`) run their PostgreSQL through it instead of a client
//! program. One bridge request a line on standard input, served by `Core::handle` as one plugin
//! (`endue.database`, or the first argument); each answer, and every event addressed to that
//! plugin, a line on standard output. A `db.open` is granted its own scope first, as the person
//! who says yes to the plugin's ask, so the core's grant check still runs on every call. Requests
//! are served on threads of their own, so a `db.cancel` reaches a statement that runs. The core's
//! home is the second argument (its `.pgpass` is the password file), else a fresh folder under the
//! temp folder, removed at the end. It ends when standard input does.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeRequest, Permission};
use desk_core::{Core, Roots};
use serde_json::json;

fn main() {
    let mut args = std::env::args().skip(1);
    let caller = args.next().unwrap_or_else(|| "endue.database".to_owned());
    let given = args.next().map(PathBuf::from);
    let made = given.is_none();
    let home = given.unwrap_or_else(|| {
        let name = format!("desk-db-bridge-{}", std::process::id());
        std::env::temp_dir().join(name)
    });
    std::fs::create_dir_all(&home).expect("the core's home");
    let core = Arc::new(Core::new(Roots { home: home.clone() }));

    let out = Arc::new(Mutex::new(std::io::stdout()));
    let say = {
        let out = out.clone();
        move |line: String| {
            let mut out = out.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            // A closed standard output ends the tests' side first; nothing is left to tell.
            let _ = writeln!(out, "{line}").and_then(|()| out.flush());
        }
    };

    let events = core.events().subscribe_addressed();
    let (heard, mine) = (say.clone(), caller.clone());
    std::thread::spawn(move || {
        for delivery in events {
            let to_me = delivery.to.as_ref().is_some_and(|to| to.contains(&mine));
            if to_me && let Ok(line) = serde_json::to_string(&delivery.event) {
                heard(line);
            }
        }
    });

    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let value = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_default();
        if value["method"] == "db.open"
            && let Ok(scope) =
                serde_json::from_value::<Permission>(value["params"]["scope"].clone())
        {
            core.grant(&caller, scope);
        }
        let request: BridgeRequest = match serde_json::from_value(value.clone()) {
            Ok(request) => request,
            Err(why) => {
                let error = json!({ "code": "invalid_params", "message": why.to_string() });
                say(json!({ "id": value["id"], "ok": false, "error": error }).to_string());
                continue;
            }
        };
        let (core, caller, answer) = (core.clone(), caller.clone(), say.clone());
        std::thread::spawn(move || {
            let response = core.handle(&caller, request);
            if let Ok(line) = serde_json::to_string(&response) {
                answer(line);
            }
        });
    }
    if made {
        // Gone already or still held open: the temp folder is the system's to clear then.
        let _ = std::fs::remove_dir_all(&home);
    }
}
