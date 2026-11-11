//! Computer use on the CEF shell (ADR 0120, ADR 0123; the Tauri shell's `computer.rs`): the core gets
//! desk-computer's OS driver and a folder for the screenshots of agents' acts, and while an agent
//! operates the computer the person sees it and can stop it from any app. A small window above every
//! app and Space shows endue.computer's banner (`ui/banner.html`) with Stop, without taking the focus
//! from the app in front; Stop and Resume come back as a navigation to `?stop` or `?resume`, which
//! the banner's browser never makes (`client.rs`). The stop key (Escape held, or the chord
//! `endue.computer.stop-key` names) is the desk's only while an agent acts.

use std::path::Path;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, ComputerActivityData};
use desk_core::Core;
use desk_web::sender::Role;
use serde_json::{Value, json};
use winit::dpi::LogicalPosition;

use crate::float::{self, Spaces};
use crate::hotkeys::Action;
use crate::pump::Pump;
use crate::window::Shell;

const PLUGIN: &str = "endue.computer";
const BANNER: (f64, f64) = (460.0, 52.0);
/// Below the menu bar, from the top of the main display.
const TOP: f64 = 34.0;
/// After an agent's last act the banner and the stop key stay this long.
const LINGER: Duration = Duration::from_secs(10);
/// Escape stops once it has been held this long; a tap stays the app's.
const HOLD: Duration = Duration::from_millis(500);
const DEFAULT_KEY: &str = "Escape";

/// What the banner's Stop and Resume ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ask {
    Stop,
    Resume,
}

/// What a navigation of the banner's browser to `url` asks for, if anything.
pub fn asked(url: &str) -> Option<Ask> {
    let page = url.split('#').next().unwrap_or_default();
    let query = page.split_once('?')?.1;
    if query.starts_with("stop") {
        Some(Ask::Stop)
    } else if query.starts_with("resume") {
        Some(Ask::Resume)
    } else {
        None
    }
}

/// The banner's page, with the first activity in its fragment.
pub fn banner_url(first: &Value) -> String {
    let mut url = url::Url::parse(&format!("desk-plugin://localhost/{PLUGIN}/ui/banner.html"))
        .unwrap_or_else(|_| unreachable!("a constant URL parses"));
    url.set_fragment(Some(&first.to_string()));
    url.into()
}

/// What the watcher knows: the key the desk holds now, whether it stops when held, and when it
/// went down.
#[derive(Default)]
pub struct Watch {
    key: Option<String>,
    hold: bool,
    pressed: Option<Instant>,
}

/// Give the core the OS driver, and show the banner and hold the stop key while agents act.
pub fn attach(core: &Arc<Core>, pump: &Pump, data: &Path) -> Arc<Mutex<Watch>> {
    core.serve_computer(desk_computer::os(), Some(data.join("computer")));
    let events = core.events().subscribe();
    let watch = Arc::new(Mutex::new(Watch::default()));
    let (pump, core, watching) = (pump.clone(), Arc::clone(core), Arc::clone(&watch));
    let spawned = std::thread::Builder::new()
        .name("desk-computer".to_owned())
        .spawn(move || {
            let mut last: Option<Instant> = None;
            loop {
                match events.recv_timeout(Duration::from_secs(1)) {
                    Ok(BridgeEvent::ComputerActivity(activity)) => {
                        heard(&pump, &core, &watching, &activity.data, &mut last);
                    }
                    Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                let idle = last.is_some_and(|at| at.elapsed() >= LINGER);
                if idle && !core.computer_stopped() {
                    last = None;
                    quiet(&pump, &watching);
                }
            }
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: computer use is not watched ({why})");
    }
    watch
}

/// One `computer.activity`: the banner hears it, and an agent's act keeps the banner and the key.
fn heard(
    pump: &Pump,
    core: &Arc<Core>,
    watch: &Arc<Mutex<Watch>>,
    data: &ComputerActivityData,
    last: &mut Option<Instant>,
) {
    use desk_bridge::ComputerActivityState as S;
    let value = serde_json::to_value(data).unwrap_or_default();
    let wanted = data.state == S::Stopped || data.agent.is_some();
    pump.run(move |shell, event_loop| match shell.pane(Role::Banner) {
        Some(pane) => eval(
            pane,
            &format!("window.deskBanner && window.deskBanner.show({value})"),
        ),
        // Made once it is first needed; the page reads this first activity from its URL.
        None if wanted => {
            let attributes = float::attributes("Eris is using your computer", BANNER);
            if let Some(pane) =
                shell.open_pane(event_loop, Role::Banner, attributes, &banner_url(&value))
            {
                float::join(&pane.window, Spaces::Over);
                if let Some(monitor) = pane.window.primary_monitor() {
                    let width = monitor
                        .size()
                        .to_logical::<f64>(monitor.scale_factor())
                        .width;
                    pane.window
                        .set_outer_position(LogicalPosition::new((width - BANNER.0) / 2.0, TOP));
                }
            }
        }
        None => {}
    });
    match data.state {
        S::Resumed => {
            *last = None;
            quiet(pump, watch);
        }
        S::Stopped => {
            *last = Some(Instant::now());
            show(pump);
        }
        S::Acting | S::Done | S::Failed if data.agent.is_some() => {
            *last = Some(Instant::now());
            show(pump);
            hold_key(pump, core, watch);
        }
        _ => {}
    }
}

fn eval(pane: &crate::pane::Pane, script: &str) {
    use cef::{ImplBrowser, ImplFrame};
    if let Some(frame) = pane.browser.as_ref().and_then(|b| b.main_frame()) {
        frame.execute_java_script(Some(&script.into()), None, 0);
    }
}

/// Show the banner over the app in front without activating the desk.
fn show(pump: &Pump) {
    pump.run(|shell, _| {
        if let Some(pane) = shell.pane(Role::Banner) {
            pane.show_quietly();
        }
    });
}

/// The agent went idle, or the person resumed: hide the banner, give the key back.
fn quiet(pump: &Pump, watch: &Arc<Mutex<Watch>>) {
    let mut held = watch.lock().unwrap_or_else(|e| e.into_inner());
    held.key = None;
    held.pressed = None;
    pump.run(|shell, _| {
        if let Some(pane) = shell.pane(Role::Banner) {
            pane.hide();
        }
        shell.hotkeys.unregister(Action::StopComputer);
    });
}

/// Hold the stop key while an agent acts: Escape held for `HOLD`, any other chord at once.
fn hold_key(pump: &Pump, core: &Core, watch: &Arc<Mutex<Watch>>) {
    let mut held = watch.lock().unwrap_or_else(|e| e.into_inner());
    if held.key.is_some() {
        return;
    }
    let key = stop_key(core);
    held.hold = matches!(key.to_ascii_lowercase().as_str(), "escape" | "esc");
    held.key = Some(key.clone());
    let label = if held.hold {
        "Hold Esc to stop".to_owned()
    } else {
        format!("{key} stops")
    };
    pump.run(move |shell, _| {
        if let Err(why) = shell.hotkeys.register(Action::StopComputer, &key) {
            eprintln!("endue Desk: the stop key {key} is unavailable ({why}); use Stop");
        }
        if let Some(pane) = shell.pane(Role::Banner) {
            let text = serde_json::to_string(&label).unwrap_or_default();
            eval(
                pane,
                &format!("window.deskBanner && window.deskBanner.key({text})"),
            );
        }
    });
}

/// The stop key went down (`pressed`) or up.
pub fn key(shell: &Shell, watch: &Arc<Mutex<Watch>>, pressed: bool) {
    let core = Arc::clone(&shell.desk.core);
    let mut held = watch.lock().unwrap_or_else(|e| e.into_inner());
    if !held.hold {
        if pressed {
            core.stop_computer();
        }
        return;
    }
    match (pressed, held.pressed) {
        (true, None) => {
            let down = Instant::now();
            held.pressed = Some(down);
            let watch = Arc::clone(watch);
            std::thread::spawn(move || {
                std::thread::sleep(HOLD);
                let still = watch.lock().unwrap_or_else(|e| e.into_inner()).pressed;
                if still == Some(down) {
                    core.stop_computer();
                }
            });
        }
        (true, Some(_)) => {}
        (false, _) => held.pressed = None,
    }
}

/// `endue.computer.stop-key`, else Escape.
fn stop_key(core: &Core) -> String {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": "stop-key" } });
    let Ok(request) = serde_json::from_value::<BridgeRequest>(request) else {
        return DEFAULT_KEY.to_owned();
    };
    let chosen = match core.handle(PLUGIN, request) {
        BridgeResponse::BridgeSuccess(ok) => ok.result["value"].as_str().map(str::to_owned),
        BridgeResponse::BridgeFailure(_) => None,
    };
    chosen
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty())
        .unwrap_or_else(|| DEFAULT_KEY.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{Ask, asked, banner_url};
    use serde_json::json;

    #[test]
    fn stop_and_resume_are_navigations_the_banner_never_makes() {
        let page = "desk-plugin://localhost/endue.computer/ui/banner.html";
        assert_eq!(asked(&format!("{page}?stop")), Some(Ask::Stop));
        assert_eq!(asked(&format!("{page}?resume")), Some(Ask::Resume));
        assert_eq!(asked(&format!("{page}?stop#x")), Some(Ask::Stop));
        assert_eq!(asked(page), None);
        assert_eq!(asked(&format!("{page}#?stop")), None);
        assert_eq!(asked(&format!("{page}?other")), None);
    }

    #[test]
    fn the_banner_opens_with_its_first_activity_in_the_fragment() {
        let url = banner_url(&json!({ "state": "acting", "agent": "a b" }));
        let (page, fragment) = url.split_once('#').unwrap();
        assert_eq!(
            page,
            "desk-plugin://localhost/endue.computer/ui/banner.html"
        );
        assert!(!fragment.contains(' '), "{fragment}");
        assert!(fragment.contains("acting"), "{fragment}");
    }
}
