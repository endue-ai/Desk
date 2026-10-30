//! desk-sys calendar primitives (feature `calendar`): the `CalendarSource` contract through
//! `FakeCalendar`, and the OS source (EventKit on macOS, `unsupported` elsewhere).
//!
//! Only the ignored macOS test reaches EventKit, and with it the person's calendars; everything else
//! runs on the fake.

use desk_sys::ErrorCode;
use desk_sys::calendar::fake::FakeCalendar;
use desk_sys::calendar::{Authorization, Calendar, CalendarSource, Event, Reminder, Status};

fn calendar(id: &str, title: &str, color: Option<&str>) -> Calendar {
    Calendar {
        id: id.to_owned(),
        title: title.to_owned(),
        color: color.map(str::to_owned),
    }
}

fn event(id: &str, calendar: &str, start: &str, end: &str) -> Event {
    Event {
        id: id.to_owned(),
        calendar: calendar.to_owned(),
        title: format!("event {id}"),
        start: start.to_owned(),
        end: end.to_owned(),
        all_day: false,
        location: None,
        recurrence: None,
    }
}

fn reminder(id: &str, list: &str, completed: Option<&str>, priority: Option<u8>) -> Reminder {
    Reminder {
        id: id.to_owned(),
        list: list.to_owned(),
        title: format!("reminder {id}"),
        due: None,
        completed: completed.map(str::to_owned),
        priority,
    }
}

fn ids<T>(items: &[T], id: impl Fn(&T) -> &str) -> Vec<String> {
    items.iter().map(|item| id(item).to_owned()).collect()
}

/// RFC 3339 with an offset: `YYYY-MM-DDThh:mm:ss`, optional fraction, then `Z` or `±hh:mm`.
fn has_offset(time: &str) -> bool {
    let bytes = time.as_bytes();
    if bytes.len() < 20 || bytes[10] != b'T' {
        return false;
    }
    if time.ends_with('Z') {
        return true;
    }
    let tail = &bytes[bytes.len() - 6..];
    matches!(tail[0], b'+' | b'-') && tail[3] == b':'
}

fn three_calendars() -> Vec<Calendar> {
    vec![
        calendar("work", "Work", Some("#1badf8")),
        calendar("home", "Home", Some("#63da38")),
        calendar("trips", "Trips", None),
    ]
}

fn three_reminders() -> Vec<Reminder> {
    vec![
        reminder("r1", "inbox", None, Some(1)),
        reminder("r2", "errands", Some("2026-11-01T18:30:00+09:00"), None),
        reminder("r3", "inbox", None, Some(3)),
    ]
}

#[test]
fn the_fake_source_lists_calendars_and_the_events_inside_a_range() {
    let source = FakeCalendar::new()
        .with_calendars(three_calendars())
        .with_events(vec![
            event(
                "late",
                "work",
                "2026-11-02T15:00:00+09:00",
                "2026-11-02T16:00:00+09:00",
            ),
            event(
                "before",
                "work",
                "2026-11-01T09:00:00+09:00",
                "2026-11-01T10:00:00+09:00",
            ),
            event(
                "after",
                "trips",
                "2026-11-03T09:00:00+09:00",
                "2026-11-03T10:00:00+09:00",
            ),
            // 08:30 in Seoul, written in UTC: compared as instants, not as text.
            event(
                "early",
                "home",
                "2026-11-01T23:30:00Z",
                "2026-11-02T00:30:00Z",
            ),
            event(
                "later",
                "home",
                "2026-11-05T09:00:00+09:00",
                "2026-11-05T10:00:00+09:00",
            ),
        ]);

    let calendars = source.calendars().unwrap();
    assert_eq!(calendars, three_calendars());

    let events = source
        .events("2026-11-02T00:00:00+09:00", "2026-11-03T00:00:00+09:00")
        .unwrap();
    assert_eq!(
        ids(&events, |e| &e.id),
        ["early", "late"],
        "ordered by start"
    );
    assert_eq!(events[0].calendar, "home");
    assert_eq!(events[1].calendar, "work");
    for event in &events {
        assert!(has_offset(&event.start), "start {:?}", event.start);
        assert!(has_offset(&event.end), "end {:?}", event.end);
        assert!(!event.all_day);
    }
}

#[test]
fn events_outside_the_range_are_left_out_and_all_day_events_keep_their_dates() {
    let mut all_day = event(
        "holiday",
        "home",
        "2026-11-03T00:00:00+09:00",
        "2026-11-04T00:00:00+09:00",
    );
    all_day.all_day = true;
    let source = FakeCalendar::new()
        .with_calendars(three_calendars())
        .with_events(vec![
            event(
                "ended",
                "work",
                "2026-11-01T23:00:00+09:00",
                "2026-11-01T23:59:59+09:00",
            ),
            event(
                "at-to",
                "work",
                "2026-11-04T00:00:00+09:00",
                "2026-11-04T01:00:00+09:00",
            ),
            all_day,
            event(
                "across",
                "work",
                "2026-11-01T23:30:00+09:00",
                "2026-11-02T00:30:00+09:00",
            ),
        ]);

    let events = source
        .events("2026-11-02T00:00:00+09:00", "2026-11-04T00:00:00+09:00")
        .unwrap();

    assert_eq!(
        ids(&events, |e| &e.id),
        ["across", "holiday"],
        "an event ending a second before `from` and one starting at `to` are left out"
    );
    let holiday = &events[1];
    assert!(holiday.all_day);
    assert!(
        holiday.start.starts_with("2026-11-03"),
        "start {:?}",
        holiday.start
    );
    assert!(has_offset(&holiday.start));
}

#[test]
fn a_range_that_does_not_parse_or_runs_backwards_answers_invalid_params() {
    let source = FakeCalendar::new().with_events(vec![event(
        "e",
        "work",
        "2026-11-02T09:00:00+09:00",
        "2026-11-02T10:00:00+09:00",
    )]);
    for (from, to) in [
        ("yesterday", "2026-11-03T00:00:00+09:00"),
        ("2026-11-02T00:00:00+09:00", "2026-11-03"),
        ("2026-11-03T00:00:00+09:00", "2026-11-02T00:00:00+09:00"),
    ] {
        let err = source.events(from, to).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidParams, "{from} .. {to}: {err}");
    }
    let empty = source
        .events("2026-11-02T09:00:00+09:00", "2026-11-02T09:00:00+09:00")
        .unwrap();
    assert!(empty.is_empty(), "an empty range holds nothing");
}

#[test]
fn reminders_filter_by_status() {
    let source = FakeCalendar::new().with_reminders(three_reminders());

    let open = source.reminders(Status::Open).unwrap();
    assert_eq!(ids(&open, |r| &r.id), ["r1", "r3"]);
    assert!(open.iter().all(|r| r.completed.is_none()));
    assert_eq!(open[0].list, "inbox");
    assert_eq!(open[0].priority, Some(1));
    assert_eq!(open[1].priority, Some(3));

    let done = source.reminders(Status::Completed).unwrap();
    assert_eq!(ids(&done, |r| &r.id), ["r2"]);
    assert_eq!(done[0].list, "errands");
    assert_eq!(done[0].priority, None);
    let completed = done[0].completed.as_deref().expect("a completion time");
    assert!(has_offset(completed), "completed {completed:?}");

    let all = source.reminders(Status::All).unwrap();
    assert_eq!(ids(&all, |r| &r.id), ["r1", "r2", "r3"]);
    assert_eq!(ids(&all, |r| &r.list), ["inbox", "errands", "inbox"]);
}

#[test]
fn a_source_without_authorization_answers_permission_denied_and_never_reaches_the_backend() {
    for status in [
        Authorization::Denied,
        Authorization::Restricted,
        Authorization::NotDetermined,
        Authorization::WriteOnly,
    ] {
        let source = FakeCalendar::new()
            .with_authorization(status)
            .with_calendars(three_calendars())
            .with_reminders(three_reminders());
        assert_eq!(source.authorization(), status);
        let refused = [
            source.calendars().map(drop),
            source
                .events("2026-11-02T00:00:00+09:00", "2026-11-03T00:00:00+09:00")
                .map(drop),
            source.reminders(Status::All).map(drop),
        ];
        for result in refused {
            let err = result.unwrap_err();
            assert_eq!(err.code, ErrorCode::PermissionDenied, "{status:?}: {err}");
        }
        assert_eq!(source.calls(), 0, "{status:?}: the backend was reached");
    }

    let source = FakeCalendar::new()
        .with_authorization(Authorization::NotDetermined)
        .with_calendars(three_calendars())
        .with_reminders(three_reminders());
    assert_eq!(source.request_access().unwrap(), Authorization::FullAccess);
    assert_eq!(source.authorization(), Authorization::FullAccess);
    assert_eq!(source.calendars().unwrap().len(), 3);
    source
        .events("2026-11-02T00:00:00+09:00", "2026-11-03T00:00:00+09:00")
        .unwrap();
    assert_eq!(source.reminders(Status::All).unwrap().len(), 3);
    assert_eq!(source.calls(), 3);

    let refused = FakeCalendar::new().with_authorization(Authorization::Denied);
    assert_eq!(refused.request_access().unwrap(), Authorization::Denied);
    assert_eq!(
        refused.calendars().unwrap_err().code,
        ErrorCode::PermissionDenied
    );
}

#[cfg(not(target_os = "macos"))]
#[test]
fn the_os_source_is_unsupported_off_macos() {
    let err = desk_sys::calendar::os()
        .err()
        .expect("no OS calendar source off macOS");
    assert_eq!(err.code, ErrorCode::Unsupported, "{err}");
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "reads the person's calendars: run on a Mac with calendar access granted"]
fn on_macos_the_os_source_lists_real_calendars_when_access_is_granted() {
    let source = desk_sys::calendar::os().expect("EventKit source");
    let status = source.authorization();
    match status {
        Authorization::NotDetermined
        | Authorization::Denied
        | Authorization::Restricted
        | Authorization::WriteOnly => {
            eprintln!(
                "calendar access is {status:?}; grant it in System Settings to read calendars"
            );
        }
        Authorization::FullAccess => {
            let calendars = source.calendars().expect("calendars");
            eprintln!("{} calendars", calendars.len());
            let events = source
                .events("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")
                .expect("events");
            for event in &events {
                assert!(
                    has_offset(&event.start) && has_offset(&event.end),
                    "{event:?}"
                );
            }
        }
    }
}
