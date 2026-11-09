//! Which plugin frame lost its renderer (#44). In Stage 1 plugins are out-of-process iframes of the
//! main browser, and CEF's `OnRenderProcessTerminated` speaks only for its main frame. Chromium's
//! DevTools protocol, inside this process, discovers every frame's target: `Target.targetCrashed`
//! names the crashed one, and that target's URL names the plugin (`desk_web::sender`). The shell
//! tells the page as `desk://frame-crashed`, and the runtime recovers the window.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use cef::*;
use desk_web::sender::Sender;
use desk_web::wire;
use serde_json::{Value, json};

use crate::host;

/// The event the page hears, with `{ plugin }`.
pub const CRASHED: &str = "desk://frame-crashed";

/// Every discovered target's URL, by target id.
#[derive(Default)]
pub struct Targets(HashMap<String, String>);

impl Targets {
    /// Read one DevTools message; the plugin whose frame crashed, when it says so.
    pub fn read(&mut self, message: &Value) -> Option<String> {
        let params = &message["params"];
        let info = &params["targetInfo"];
        match message["method"].as_str()? {
            "Target.targetCreated" | "Target.targetInfoChanged" => {
                let id = info["targetId"].as_str()?;
                self.0.insert(
                    id.to_owned(),
                    info["url"].as_str().unwrap_or_default().to_owned(),
                );
                None
            }
            "Target.targetDestroyed" => {
                self.0.remove(params["targetId"].as_str()?);
                None
            }
            "Target.targetCrashed" => {
                let url = self.0.get(params["targetId"].as_str()?)?;
                match Sender::of(url) {
                    Sender::Plugin(plugin) => Some(plugin),
                    _ => None,
                }
            }
            _ => None,
        }
    }
}

wrap_dev_tools_message_observer! {
    pub struct CrashWatch {
        targets: Arc<Mutex<Targets>>,
    }

    impl DevToolsMessageObserver {
        fn on_dev_tools_message(
            &self,
            browser: Option<&mut Browser>,
            message: Option<&[u8]>,
        ) -> ::std::os::raw::c_int {
            let Some(message) = message.and_then(|m| serde_json::from_slice::<Value>(m).ok()) else {
                return 0;
            };
            let crashed = self.targets.lock().unwrap_or_else(|e| e.into_inner()).read(&message);
            if let (Some(plugin), Some(frame)) = (crashed, browser.and_then(|b| b.main_frame())) {
                eprintln!("endue Desk: the renderer of {plugin} stopped");
                host::send(frame, wire::event(CRASHED, json!({ "plugin": plugin })));
            }
            0
        }
    }
}

/// Watch `browser`'s frames for crashes; keep the returned registration as long as the browser.
pub fn watch(browser: &Browser) -> Option<Registration> {
    let host = browser.host()?;
    let mut observer = CrashWatch::new(Arc::new(Mutex::new(Targets::default())));
    let registration = host.add_dev_tools_message_observer(Some(&mut observer));
    let discover =
        json!({ "id": 1, "method": "Target.setDiscoverTargets", "params": { "discover": true } });
    host.send_dev_tools_message(Some(discover.to_string().as_bytes()));
    registration
}

#[cfg(test)]
mod tests {
    use super::Targets;
    use serde_json::json;

    fn target(method: &str, id: &str, url: &str) -> serde_json::Value {
        json!({ "method": method, "params": { "targetInfo": { "targetId": id, "url": url, "type": "iframe" } } })
    }

    #[test]
    fn a_crashed_target_names_the_plugin_its_url_last_said() {
        let mut targets = Targets::default();
        assert_eq!(
            targets.read(&target("Target.targetCreated", "T1", "")),
            None
        );
        let url = "desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=1";
        assert_eq!(
            targets.read(&target("Target.targetInfoChanged", "T1", url)),
            None
        );
        let crashed = json!({ "method": "Target.targetCrashed", "params": { "targetId": "T1", "status": "crashed" } });
        assert_eq!(targets.read(&crashed).as_deref(), Some("endue.notes"));
    }

    #[test]
    fn the_shell_page_an_unknown_target_and_a_gone_one_name_no_plugin() {
        let mut targets = Targets::default();
        targets.read(&target(
            "Target.targetCreated",
            "P",
            "desk-app://app/index.html",
        ));
        targets.read(&target(
            "Target.targetCreated",
            "G",
            "desk-plugin://main.endue-git/endue.git/ui/index.html",
        ));
        targets.read(&json!({ "method": "Target.targetDestroyed", "params": { "targetId": "G" } }));
        for id in ["P", "G", "nope"] {
            let crashed = json!({ "method": "Target.targetCrashed", "params": { "targetId": id } });
            assert_eq!(targets.read(&crashed), None, "{id}");
        }
    }
}
