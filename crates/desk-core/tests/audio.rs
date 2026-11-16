//! audio.capture.* through `Core::handle` over a fake input (`desk_sys::audio::fake`), so no test
//! opens a real microphone: a capture needs `audio:capture`, asked once as perm.request asks, and
//! then the OS's grant; its frames reach only its caller as `audio.frame`, `audio.ended` comes once
//! with the reason, the runtime hears `audio.capturing` and may stop any capture, and a capture ends
//! with its plugin, its grant or its caller's last surface.

mod support;

use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;

use base64::Engine as _;
use desk_bridge::{BridgeError, ErrorCode, Permission, PluginStatus};
use desk_core::{Core, Delivery, Prompter};
use desk_sys::audio::fake::FakeInput;
use desk_sys::audio::{Authorization, InputDevice};
use desk_sys::{Error, ErrorCode as SysCode};
use serde_json::{Value, json};
use support::{Seen, SayYes, call, drain, grant, home, plugin_manage, roots, set_enabled, wait_for};

const MIC: &str = "fake:mic";
const HELLO: &str = "example.hello";
const OTHER: &str = "example.other";

fn scope() -> Value {
    json!({ "permission": "audio:capture" })
}

/// A 16 kHz mono microphone, so frames pass through without resampling.
fn input() -> FakeInput {
    FakeInput::new().with_devices(vec![InputDevice {
        id: MIC.to_owned(),
        name: "Fake mic".to_owned(),
        default: true,
        sample_rate: 16_000,
        channels: 1,
    }])
}

/// Install the UI plugin `id`, which declares the surface `main`.
fn install_ui(core: &Core, home: &Path, id: &str) {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>hello</p>").unwrap();
    let manifest = json!({
        "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "surfaces": [{ "id": "main", "placement": "center" }, { "id": "panel", "placement": "right" }],
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    let info = core.install_plugin(&dir, false);
    assert_eq!(info.status, PluginStatus::Ready, "{:?}", info.error);
}

/// A core over `input` with `example.hello` and `example.other` installed.
fn core_with(input: &Arc<FakeInput>) -> Core {
    let home = home("audio");
    let core = Core::new(roots(&home)).with_audio(input.clone());
    install_ui(&core, &home, HELLO);
    install_ui(&core, &home, OTHER);
    core
}

fn start(core: &Core, caller: &str, params: Value) -> Result<String, BridgeError> {
    call(core, caller, "audio.capture.start", params)
        .map(|started| started["captureId"].as_str().unwrap().to_owned())
}

fn start_plain(core: &Core, caller: &str) -> Result<String, BridgeError> {
    start(core, caller, json!({ "scope": scope() }))
}

fn stop(core: &Core, caller: &str, capture: &str) -> Result<Value, BridgeError> {
    let params = json!({ "captureId": capture, "scope": scope() });
    call(core, caller, "audio.capture.stop", params)
}

/// The `audio.ended` for `capture`, waiting for it.
fn ended(deliveries: &Receiver<Delivery>, capture: &str) -> Seen {
    loop {
        let seen = wait_for(deliveries, "audio.ended");
        if seen.data()["captureId"] == capture {
            return seen;
        }
    }
}

/// A full-scale 500 Hz sine at 16 kHz.
fn sine(samples: usize) -> Vec<f32> {
    (0..samples)
        .map(|i| (i as f32 * 500.0 * std::f32::consts::TAU / 16_000.0).sin())
        .collect()
}

/// Counts how often the person is asked, and answers `yes`.
struct Counting {
    asked: Arc<AtomicUsize>,
    yes: bool,
}

impl Prompter for Counting {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        self.asked.fetch_add(1, Ordering::SeqCst);
        self.yes
    }
}

#[test]
fn start_without_the_permission_is_denied() {
    let input = Arc::new(input());
    let core = core_with(&input);
    let refused = start_plain(&core, HELLO).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(input.captures_opened(MIC), 0, "no device opens");
}

#[test]
fn first_capture_asks_through_the_prompt() {
    let input = Arc::new(input());
    let asked = Arc::new(AtomicUsize::new(0));
    let core = core_with(&input).with_prompter(Counting { asked: asked.clone(), yes: true });
    let first = start_plain(&core, HELLO).unwrap();
    let second = start_plain(&core, HELLO).unwrap();
    assert_ne!(first, second);
    assert_eq!(asked.load(Ordering::SeqCst), 1, "asked once, then the grant holds");
    assert_eq!(input.open_captures(MIC), 2);

    let refusing = Arc::new(input());
    let asked = Arc::new(AtomicUsize::new(0));
    let core = core_with(&refusing).with_prompter(Counting { asked: asked.clone(), yes: false });
    let refused = start_plain(&core, HELLO).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(asked.load(Ordering::SeqCst), 1);
    assert_eq!(refusing.captures_opened(MIC), 0);
}

#[test]
fn os_refusal_is_permission_denied() {
    let denied = Arc::new(input().with_authorization(Authorization::Denied));
    let core = core_with(&denied);
    grant(&core, HELLO, scope());
    let refused = start_plain(&core, HELLO).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(denied.captures_opened(MIC), 0);

    let asks = Arc::new(input().with_authorization(Authorization::NotDetermined));
    let core = core_with(&asks);
    grant(&core, HELLO, scope());
    start_plain(&core, HELLO).expect("the OS was asked and said yes");
    assert_eq!(asks.open_captures(MIC), 1);

    let says_no = Arc::new(
        input()
            .with_authorization(Authorization::NotDetermined)
            .with_answer(Authorization::Denied),
    );
    let core = core_with(&says_no);
    grant(&core, HELLO, scope());
    let refused = start_plain(&core, HELLO).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(says_no.captures_opened(MIC), 0);
}

#[test]
fn frames_arrive_as_audio_frame_events() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    input.push(MIC, &sine(640));
    stop(&core, HELLO, &capture).unwrap();
    ended(&deliveries, &capture);

    let frames: Vec<Seen> = drain(&deliveries)
        .into_iter()
        .filter(|seen| seen.name() == "audio.frame")
        .collect();
    assert_eq!(frames.len(), 2, "{frames:?}");
    for (i, frame) in frames.iter().enumerate() {
        assert_eq!(frame.to, Some(vec![HELLO.to_owned()]), "only the caller hears it");
        let data = frame.data();
        assert_eq!(data["captureId"], capture);
        assert_eq!(data["atMs"], 20 * i as u64);
        assert_eq!(data["sampleRate"], 16_000);
        let pcm = base64::engine::general_purpose::STANDARD
            .decode(data["pcm"].as_str().unwrap())
            .unwrap();
        assert_eq!(pcm.len(), 640, "320 samples of LINEAR16");
        let rms = data["rmsDb"].as_f64().unwrap();
        assert!((rms + 3.01).abs() < 0.3, "{rms}");
    }
}

#[test]
fn stop_ends_the_capture() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    assert_eq!(stop(&core, HELLO, &capture).unwrap(), json!({}));
    assert_eq!(input.open_captures(MIC), 0);
    let end = ended(&deliveries, &capture);
    assert_eq!(end.data()["reason"], "stopped");
    assert_eq!(end.to, Some(vec![HELLO.to_owned()]));
    assert_eq!(
        stop(&core, HELLO, &capture).unwrap(),
        json!({}),
        "stopping an ended capture is not an error"
    );
    assert!(drain(&deliveries).iter().all(|s| s.name() != "audio.ended"), "ended comes once");
    let unknown = stop(&core, HELLO, "no-such-capture").unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound);
}

#[test]
fn another_callers_capture_is_not_found() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    grant(&core, OTHER, scope());
    let capture = start_plain(&core, HELLO).unwrap();
    let refused = stop(&core, OTHER, &capture).unwrap_err();
    assert_eq!(refused.code, ErrorCode::NotFound);
    assert_eq!(input.open_captures(MIC), 1);
}

#[test]
fn the_runtime_stops_any_capture() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    grant(&core, "desk", scope());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    stop(&core, "desk", &capture).unwrap();
    assert_eq!(input.open_captures(MIC), 0);
    let end = ended(&deliveries, &capture);
    assert_eq!(end.data()["reason"], "stopped_by_person");
    assert_eq!(end.to, Some(vec![HELLO.to_owned()]));
}

#[test]
fn unload_stops_the_plugins_captures() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    grant(&core, "desk", plugin_manage());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    set_enabled(&core, HELLO, false);
    assert_eq!(input.open_captures(MIC), 0);
    assert_eq!(ended(&deliveries, &capture).data()["reason"], "plugin_stopped");
}

#[test]
fn last_surface_closing_stops_captures() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    grant(&core, HELLO, json!({ "permission": "ui:surface" }));
    let open = |surface: &str| {
        let params = json!({ "surface": surface, "scope": { "permission": "ui:surface" } });
        call(&core, HELLO, "ui.surface.open", params).unwrap()["handle"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let close = |handle: &str| {
        let params = json!({ "handle": handle, "scope": { "permission": "ui:surface" } });
        call(&core, HELLO, "ui.surface.close", params).unwrap();
    };
    let main = open("main");
    let panel = open("panel");
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();

    close(&main);
    assert_eq!(input.open_captures(MIC), 1, "the panel is still open");
    close(&panel);
    assert_eq!(input.open_captures(MIC), 0);
    assert_eq!(ended(&deliveries, &capture).data()["reason"], "surface_closed");
}

#[test]
fn revoke_stops_captures() {
    let input = Arc::new(input());
    let core = core_with(&input);
    let grant_id = grant(&core, HELLO, scope());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    call(&core, HELLO, "perm.revoke", json!({ "grantId": grant_id })).unwrap();
    assert_eq!(input.open_captures(MIC), 0);
    assert_eq!(ended(&deliveries, &capture).data()["reason"], "revoked");
}

#[test]
fn device_failure_ends_with_the_error() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    let deliveries = core.events().subscribe_addressed();
    let capture = start_plain(&core, HELLO).unwrap();
    input.fail(MIC, Error::new(SysCode::IoError, "the input device is gone"));
    let end = ended(&deliveries, &capture);
    assert_eq!(end.data()["reason"], "device");
    assert!(
        end.data()["message"].as_str().unwrap().contains("gone"),
        "{end:?}"
    );
    let capturing = wait_for(&deliveries, "audio.capturing");
    assert_eq!(capturing.data()["captures"], json!([]));
}

#[test]
fn wake_word_is_unsupported() {
    let input = Arc::new(input());
    let core = core_with(&input).with_prompter(SayYes);
    let wake = json!({ "permission": "audio:capture", "wakeWord": true });
    grant(&core, HELLO, wake.clone());
    let refused = start(&core, HELLO, json!({ "wakeWord": true, "scope": wake })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::Unsupported, "{refused:?}");
    assert_eq!(input.captures_opened(MIC), 0);
}

#[test]
fn the_runtime_hears_who_captures() {
    let input = Arc::new(input());
    let core = core_with(&input);
    grant(&core, HELLO, scope());
    grant(&core, OTHER, scope());
    let deliveries = core.events().subscribe_addressed();
    let first = start_plain(&core, HELLO).unwrap();
    let second = start_plain(&core, OTHER).unwrap();
    stop(&core, HELLO, &first).unwrap();

    let seen: Vec<Seen> = drain(&deliveries)
        .into_iter()
        .filter(|seen| seen.name() == "audio.capturing")
        .collect();
    assert!(seen.iter().all(|s| s.to == Some(vec!["desk".to_owned()])), "{seen:?}");
    let lists: Vec<Value> = seen.iter().map(|s| s.data()["captures"].clone()).collect();
    assert_eq!(
        lists,
        [
            json!([{ "captureId": first, "caller": HELLO }]),
            json!([{ "captureId": first, "caller": HELLO }, { "captureId": second, "caller": OTHER }]),
            json!([{ "captureId": second, "caller": OTHER }]),
        ]
    );
}
