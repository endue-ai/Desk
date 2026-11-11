//! One scene, two ways to it (#82): this crate's `Desk` directly, and the runtime's actions and
//! edits on desk-wm as WebAssembly (`packages/runtime/src/shell/desk-view.scene.test.ts`, #83)
//! build the same desk with the same steps, and both snapshots must equal the contract's vector
//! `desk-windows-list-scene.json` (specs/bridge/v0, target `BrainDesk`). Change a step here and in
//! the TS test together.

mod common;

use std::path::Path;

use common::EPOCH;
use desk_wm::{Adopted, Desk, Fill, Frame, Offset, Rect, Seen, SplitDir};
use serde_json::Value;

/// What the runtime knows and the window manager does not: the shell's titles as the TS test's
/// copy gives them (the key itself), and how the scene's frames are doing.
struct Runtime;

impl Seen for Runtime {
    fn title(&self, view: &str) -> Option<String> {
        match view {
            "launcher" => Some("launcherTitle".into()),
            "calendar" => Some("surfaceCalendar".into()),
            _ => None,
        }
    }

    fn frame(&self, plugin: &str) -> Frame {
        match plugin {
            "endue.notes" => Frame::Late,
            "endue.git" => Frame::Stopped,
            "endue.mail" => Frame::Asleep,
            _ => Frame::Live,
        }
    }
}

fn scene() -> Desk {
    let mut desk = Desk::default();
    // Four plugin windows handed over, in slots 0 to 3.
    let plugins = [
        ("endue.git", "Git"),
        ("endue.notes", "Notes"),
        ("endue.mail", "Mail"),
        ("e2e.hello", "Hello"),
    ];
    desk.set(|d| {
        d.adopted = (plugins.iter().enumerate())
            .map(|(slot, (id, title))| Adopted {
                id: (*id).into(),
                title: (*title).into(),
                slot: Some(slot),
                at: None,
                area: None,
            })
            .collect();
    });
    desk.place("endue.notes", Rect::new(40.0, 60.0, 600.0, 400.0));
    desk.place("endue.git", Rect::new(700.0, 60.0, 680.0, 760.0));
    desk.toggle_floating("endue.notes", 1440.0, 900.0);
    desk.snap_to("endue.mail", Fill::Right);
    desk.toggle_pin("endue.git");
    let one = desk.new_window();
    desk.split(SplitDir::Row);
    let two = desk.new_window();
    desk.toggle_maximize(&two);
    desk.put_away("e2e.hello", "Hello", EPOCH + 1000);
    // A shell view on desktop 2, its canvas panned; then back to desktop 1, panned too.
    desk.set_desktop("2");
    desk.open_surface("calendar", None);
    desk.set(|d| {
        d.pan.insert("2".into(), Offset::new(-100.0, 50.0));
    });
    desk.set_desktop("1");
    desk.set(|d| {
        d.pan.insert("1".into(), Offset::new(30.5, -20.4));
    });
    desk.focus_pane(&one, Some("p1"));
    desk
}

#[test]
fn the_scene_is_the_contracts_vector_window_for_window() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs/bridge/v0/vectors/valid/desk-windows-list-scene.json");
    let vector: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(vector["target"], "BrainDesk");
    let shot = serde_json::to_value(scene().snapshot_seen(1440.0, 900.0, &Runtime)).unwrap();
    // One window at a time first, so a difference names its window.
    let (got, want) = (
        shot["windows"].as_array(),
        vector["instance"]["windows"].as_array(),
    );
    for (got, want) in got.unwrap().iter().zip(want.unwrap()) {
        assert_eq!(got, want);
    }
    assert_eq!(shot, vector["instance"]);
}

#[test]
fn without_the_runtime_no_title_of_its_own_and_every_frame_live() {
    let shot = scene().snapshot(1440.0, 900.0);
    let mail = shot.windows.iter().find(|w| w.id == "endue.mail").unwrap();
    assert_eq!(
        (mail.panes[0].asleep, mail.panes[0].responsiveness),
        (None, None)
    );
    let one = shot.windows.iter().find(|w| w.id == "window-1").unwrap();
    assert_eq!(one.panes[0].title, None);
    assert_eq!(mail.panes[0].title.as_deref(), Some("Mail"));
}
