//! What the connector tests share: the person's calendars and reminders on a fake Mac, copies of
//! examples/plugin-hello-connector, files with a given modification time, and short ways to ask.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use desk_bridge::BridgeError;
use desk_sys::calendar::fake::FakeCalendar;
use desk_sys::calendar::{Authorization, Calendar, CalendarSource, Event, Reminder};
use serde_json::{Value, json};

use super::{DAY, Desk, HELLO, HOUR, NOW, ids, time};

/// An event in the Work calendar, `hours` long.
pub fn event(id: &str, title: &str, start: u64, hours: u64) -> Event {
    Event {
        id: id.to_owned(),
        calendar: "cal-work".to_owned(),
        title: title.to_owned(),
        start: time(start),
        end: time(start + hours * HOUR),
        all_day: false,
        location: None,
        recurrence: None,
    }
}

pub fn reminder(id: &str, title: &str, due: Option<u64>, completed: Option<u64>) -> Reminder {
    Reminder {
        id: id.to_owned(),
        list: "list-home".to_owned(),
        title: title.to_owned(),
        due: due.map(time),
        completed: completed.map(time),
        priority: None,
    }
}

/// The Work calendar (with a color) and the Home reminder list.
pub fn calendars() -> Vec<Calendar> {
    vec![
        Calendar {
            id: "cal-work".to_owned(),
            title: "Work".to_owned(),
            color: Some("#3366ff".to_owned()),
        },
        Calendar {
            id: "list-home".to_owned(),
            title: "Home".to_owned(),
            color: None,
        },
    ]
}

/// A Mac whose person was never asked, and says yes: a standup, a weekly review on two days, one
/// event 40 days ago and one 200 days ahead; an open reminder, one done two days ago and one done
/// 40 days ago.
pub fn mac() -> FakeCalendar {
    let mut standup = event("e-standup", "Standup", NOW + 9 * HOUR, 1);
    standup.location = Some("Room 1".to_owned());
    let weekly = |start| Event {
        recurrence: Some("FREQ=WEEKLY".to_owned()),
        ..event("e-review", "Weekly review", start, 1)
    };
    let mut rent = reminder("r-rent", "Pay rent", Some(NOW + 2 * DAY), None);
    rent.priority = Some(1);
    FakeCalendar::new()
        .with_authorization(Authorization::NotDetermined)
        .with_answer(Authorization::FullAccess)
        .with_calendars(calendars())
        .with_events(vec![
            standup,
            weekly(NOW + DAY),
            weekly(NOW + 8 * DAY),
            event("e-old", "Long ago", NOW - 40 * DAY, 1),
            event("e-far", "Far ahead", NOW + 200 * DAY, 1),
        ])
        .with_reminders(vec![
            rent,
            reminder("r-called", "Call the bank", None, Some(NOW - 2 * DAY)),
            reminder("r-old", "Renew the passport", None, Some(NOW - 40 * DAY)),
        ])
}

/// A copy of examples/plugin-hello-connector (its manifest and component) under `parent`, its
/// manifest changed by `edit`.
pub fn hello_copy(parent: &Path, edit: impl FnOnce(&mut Value)) -> PathBuf {
    let example =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugin-hello-connector");
    let dir = parent.join("hello-connector");
    let wasm = "build/wasm32-wasip2/release/hello_connector.wasm";
    fs::create_dir_all(dir.join(wasm).parent().unwrap()).unwrap();
    fs::copy(example.join(wasm), dir.join(wasm)).unwrap();
    let text = fs::read_to_string(example.join("plugin.json")).unwrap();
    let mut manifest: Value = serde_json::from_str(&text).unwrap();
    edit(&mut manifest);
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    dir
}

/// Write `text` to `path` and set its modification time to `secs`.
pub fn write_at(path: &Path, text: &str, secs: u64) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
    let file = fs::OpenOptions::new().write(true).open(path).unwrap();
    file.set_modified(UNIX_EPOCH + Duration::from_secs(secs))
        .unwrap();
}

/// A desk over `calendar`, and the calendar to look at afterwards.
pub fn mac_desk(tag: &str, calendar: FakeCalendar) -> (Desk, Arc<FakeCalendar>) {
    let calendar = Arc::new(calendar);
    let shared: Arc<dyn CalendarSource> = calendar.clone();
    (Desk::new(tag, Some(shared)), calendar)
}

pub fn by_id<'a>(items: &'a [Value], id: &str) -> &'a Value {
    let found = items.iter().find(|i| i["id"] == id);
    found.unwrap_or_else(|| panic!("no {id} among {:?}", ids(items)))
}

/// hello-connector installed from a copy, with `fs:read` on `~/Notes/**` granted when `granted`.
pub fn hello(desk: &Desk, granted: bool, edit: impl FnOnce(&mut Value)) {
    let dir = hello_copy(&desk.home.join("plugins"), edit);
    desk.core.install_plugin(&dir, false);
    if granted {
        let notes = json!({ "permission": "fs:read", "paths": ["~/Notes/**"] });
        desk.grant(HELLO, notes);
    }
}

/// Connect hello-connector's `instance` on `~/Notes`, titled Notes.
pub fn notes(desk: &Desk, instance: &str) -> Result<Value, BridgeError> {
    let settings = json!({ "folder": "~/Notes" });
    desk.connect(json!({
        "connector": HELLO, "instance": instance, "title": "Notes", "settings": settings,
    }))
}

/// An instance's state as connector.list shows it.
pub fn state(instance: &Value) -> &str {
    instance["status"]["state"].as_str().unwrap()
}
