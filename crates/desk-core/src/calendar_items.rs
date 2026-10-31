//! The built-in connectors' items: the OS calendar's events as `event` items and its reminders as
//! `task` items (specs/item/v0), over the sync window, and what a sync writes. desk-sys gives no
//! last-modified time, so a new or changed item is stamped with the sync's time and an unchanged
//! one is not written again (ADR 0036).

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use desk_bridge::{Item, ItemSource};
use desk_plugin_host::rfc3339;
use desk_sys::calendar::{Calendar, CalendarSource, Event, Reminder, Status};
use serde_json::{Map, Value, json};

use crate::time::parse_rfc3339;

pub(crate) const CALENDAR: &str = "desk.calendar";
pub(crate) const REMINDERS: &str = "desk.reminders";
pub(crate) const INSTANCE: &str = "default";

const DAY: u64 = 86_400;
/// Events overlapping [now - 30 days, now + 180 days); reminders open or done in the last 30 days.
const PAST_DAYS: u64 = 30;
const AHEAD_DAYS: u64 = 180;

/// The items the source holds now for `connector`, without `updatedAt`, by id.
pub(crate) fn fetch(
    source: &dyn CalendarSource,
    connector: &str,
    now: SystemTime,
) -> Result<BTreeMap<String, Value>, String> {
    let failed = |e: desk_sys::Error| e.message;
    let calendars: BTreeMap<String, Calendar> = source
        .calendars()
        .map_err(failed)?
        .into_iter()
        .map(|calendar| (calendar.id.clone(), calendar))
        .collect();
    let past = now.checked_sub(Duration::from_secs(PAST_DAYS * DAY));
    let past = past.unwrap_or(UNIX_EPOCH);
    let items = if connector == CALENDAR {
        let ahead = now + Duration::from_secs(AHEAD_DAYS * DAY);
        let events = source.events(&rfc3339(past), &rfc3339(ahead));
        let events = events.map_err(failed)?;
        events.iter().map(|e| event(e, &calendars)).collect()
    } else {
        let since = seconds(past);
        let reminders = source.reminders(Status::All).map_err(failed)?;
        let recent = |r: &&Reminder| match &r.completed {
            None => true,
            Some(at) => parse_rfc3339(at).is_none_or(|at| at >= since),
        };
        let kept = reminders.iter().filter(recent);
        kept.map(|r| reminder(r, &calendars)).collect::<Vec<_>>()
    };
    Ok(items
        .into_iter()
        .map(|item| (item["id"].as_str().unwrap_or_default().to_owned(), item))
        .collect())
}

/// What a sync writes: the items that are new or differ from `existing` (`updatedAt` aside),
/// stamped `updated_at`, and the ids of the existing items the source no longer holds.
pub(crate) fn changes(
    existing: &BTreeMap<String, Value>,
    fresh: BTreeMap<String, Value>,
    updated_at: &str,
) -> Result<(Vec<Item>, Vec<String>), String> {
    let removed = existing
        .keys()
        .filter(|id| !fresh.contains_key(*id))
        .cloned()
        .collect();
    let mut upserted = Vec::new();
    for (id, mut item) in fresh {
        item["updatedAt"] = json!(updated_at);
        let typed: Item = serde_json::from_value(item)
            .map_err(|e| format!("{id} does not fit specs/item/v0: {e}"))?;
        if existing.get(&id) != Some(&comparable(&typed)) {
            upserted.push(typed);
        }
    }
    Ok((upserted, removed))
}

/// An item as the index holds it, as JSON without `updatedAt`, to compare with a fresh one.
pub(crate) fn comparable(item: &Item) -> Value {
    let mut value = serde_json::to_value(item).unwrap_or_default();
    if let Some(fields) = value.as_object_mut() {
        fields.remove("updatedAt");
    }
    value
}

pub(crate) fn source(connector: &str) -> ItemSource {
    ItemSource {
        connector: connector.to_owned(),
        instance: INSTANCE.to_owned(),
    }
}

/// An event: one item per occurrence of a repeating one (`<id>@<start>`).
fn event(event: &Event, calendars: &BTreeMap<String, Calendar>) -> Value {
    let id = match &event.recurrence {
        Some(_) => format!("{}@{}", event.id, event.start),
        None => event.id.clone(),
    };
    let calendar = calendars.get(&event.calendar);
    let mut raw = Map::new();
    raw.insert("calendarId".into(), json!(event.calendar));
    raw.insert("eventId".into(), json!(event.id));
    if let Some(color) = calendar.and_then(|c| c.color.as_ref()) {
        raw.insert("color".into(), json!(color));
    }
    let mut item = json!({
        "id": id, "source": source(CALENDAR), "kind": "event", "title": event.title,
        "start": event.start, "end": event.end, "allDay": event.all_day, "raw": raw,
    });
    set(&mut item, "location", event.location.clone());
    set(&mut item, "recurrence", event.recurrence.clone());
    set(&mut item, "calendar", calendar.map(|c| c.title.clone()));
    item
}

/// A reminder: `done` once completed, else `open`, in the project named after its list.
fn reminder(reminder: &Reminder, calendars: &BTreeMap<String, Calendar>) -> Value {
    let list = calendars.get(&reminder.list);
    let mut raw = Map::new();
    raw.insert("listId".into(), json!(reminder.list));
    if let Some(color) = list.and_then(|c| c.color.as_ref()) {
        raw.insert("color".into(), json!(color));
    }
    let status = if reminder.completed.is_some() {
        "done"
    } else {
        "open"
    };
    let mut item = json!({
        "id": reminder.id, "source": source(REMINDERS), "kind": "task",
        "title": reminder.title, "status": status, "raw": raw,
    });
    set(&mut item, "completedAt", reminder.completed.clone());
    set(&mut item, "due", reminder.due.clone());
    set(&mut item, "priority", reminder.priority);
    set(&mut item, "project", list.map(|c| c.title.clone()));
    item
}

fn set<T: serde::Serialize>(item: &mut Value, key: &str, value: Option<T>) {
    if let Some(value) = value {
        item[key] = json!(value);
    }
}

/// Whole seconds since the Unix epoch.
pub(crate) fn seconds(time: SystemTime) -> i64 {
    let secs = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    i64::try_from(secs).unwrap_or(i64::MAX)
}
