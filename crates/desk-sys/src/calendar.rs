//! Calendar primitives: the person's calendars, events and reminders, read only. desk-core checks
//! the Desk grant; here a source refuses with `permission_denied` until the OS grants read access,
//! without reaching the OS store. `os()` is EventKit on macOS and `unsupported` elsewhere; `fake` is
//! a source in memory for tests, here and in the crates above.
//!
//! The structs mirror `specs/item/v0` event and task by field name. Every time is an RFC 3339
//! string with an offset.

use std::cmp::Ordering;

use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::{Error, ErrorCode};

#[cfg(target_os = "macos")]
mod eventkit;
pub mod fake;

/// Whether the OS lets Desk read calendars and reminders; `EKAuthorizationStatus` by name. macOS
/// before 14 says `Authorized`, which is `FullAccess` here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Authorization {
    /// Never asked: `request_access` shows the OS prompt.
    NotDetermined,
    /// The person said no; only System Settings changes it.
    Denied,
    /// A policy (parental controls, MDM) forbids access.
    Restricted,
    /// Reading is allowed.
    FullAccess,
    /// Adding events is allowed, reading is not.
    WriteOnly,
}

impl Authorization {
    /// Whether a source may read with this authorization.
    pub fn can_read(self) -> bool {
        self == Self::FullAccess
    }
}

/// Which reminders `reminders` answers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Status {
    #[default]
    Open,
    Completed,
    All,
}

/// A calendar of events or a list of reminders.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Calendar {
    pub id: String,
    pub title: String,
    /// `#rrggbb` in sRGB.
    pub color: Option<String>,
}

/// One event, or one occurrence of a repeating event.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Event {
    pub id: String,
    /// The id of its `Calendar`.
    pub calendar: String,
    pub title: String,
    /// RFC 3339 with an offset. An all-day event starts at local midnight of its first day.
    pub start: String,
    /// RFC 3339 with an offset, exclusive.
    pub end: String,
    pub all_day: bool,
    pub location: Option<String>,
    /// The first recurrence rule as an RRULE value (`FREQ=WEEKLY;BYDAY=MO`), if it repeats.
    pub recurrence: Option<String>,
}

/// One reminder (a task).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Reminder {
    pub id: String,
    /// The id of its list, a `Calendar`.
    pub list: String,
    pub title: String,
    /// RFC 3339 with an offset; a due date without a time is local midnight.
    pub due: Option<String>,
    /// When it was completed; `None` while it is open.
    pub completed: Option<String>,
    /// 1 (high) to 4, as `specs/item/v0` task priority; `None` when it has none.
    pub priority: Option<u8>,
}

/// A source of calendars, events and reminders. A call reaches the backend only once the OS lets
/// Desk read what it asks for; until then it answers `permission_denied`. `FullAccess` from
/// `authorization()` means every call may read.
pub trait CalendarSource: Send + Sync {
    /// The current authorization. Never prompts.
    fn authorization(&self) -> Authorization;
    /// Ask the OS for read access, showing its prompt if the person was never asked, and block
    /// until it answers. Returns the authorization afterwards.
    fn request_access(&self) -> Result<Authorization, Error>;
    /// Every calendar and reminder list, ordered by title.
    fn calendars(&self) -> Result<Vec<Calendar>, Error>;
    /// The events overlapping `[from, to)` (RFC 3339), ordered by start. `invalid_params` when either
    /// does not parse or `to` is before `from`.
    fn events(&self, from: &str, to: &str) -> Result<Vec<Event>, Error>;
    /// The reminders with `status`, ordered by due date (undated last), then title.
    fn reminders(&self, status: Status) -> Result<Vec<Reminder>, Error>;
}

/// The OS source: EventKit on macOS.
#[cfg(target_os = "macos")]
pub fn os() -> Result<Box<dyn CalendarSource>, Error> {
    Ok(Box::new(eventkit::EventKit::new()))
}

/// The OS source: none here yet.
#[cfg(not(target_os = "macos"))]
pub fn os() -> Result<Box<dyn CalendarSource>, Error> {
    Err(Error::new(
        ErrorCode::Unsupported,
        "the OS calendar is read only on macOS for now",
    ))
}

/// A parsed `[from, to)`.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Range {
    pub(crate) from: OffsetDateTime,
    pub(crate) to: OffsetDateTime,
}

impl Range {
    pub(crate) fn parse(from: &str, to: &str) -> Result<Self, Error> {
        let parse = |text: &str| {
            parse_time(text).ok_or_else(|| {
                Error::new(
                    ErrorCode::InvalidParams,
                    format!("{text:?} is not an RFC 3339 time with an offset"),
                )
            })
        };
        let range = Self {
            from: parse(from)?,
            to: parse(to)?,
        };
        if range.to < range.from {
            return Err(Error::new(
                ErrorCode::InvalidParams,
                format!("{to} is before {from}"),
            ));
        }
        Ok(range)
    }

    /// Whether `[start, end)` overlaps the range; a zero-length event counts at its start.
    pub(crate) fn holds(&self, start: OffsetDateTime, end: OffsetDateTime) -> bool {
        self.from < self.to && start < self.to && (start >= self.from || end > self.from)
    }
}

pub(crate) fn parse_time(text: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(text, &Rfc3339).ok()
}

/// The `permission_denied` a source answers before reaching its backend.
pub(crate) fn denied(what: &str, authorization: Authorization) -> Error {
    Error::new(
        ErrorCode::PermissionDenied,
        format!("reading {what} needs full access from the OS; it is {authorization:?}"),
    )
}

pub(crate) fn sort_calendars(calendars: &mut [Calendar]) {
    calendars.sort_by(|a, b| a.title.cmp(&b.title).then_with(|| a.id.cmp(&b.id)));
}

/// By start, then end, then title. Times are compared as instants.
pub(crate) fn sort_events(events: &mut [Event]) {
    events.sort_by(|a, b| {
        by_time(&a.start, &b.start)
            .then_with(|| by_time(&a.end, &b.end))
            .then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// By due date with undated ones last, then title.
pub(crate) fn sort_reminders(reminders: &mut [Reminder]) {
    reminders.sort_by(|a, b| {
        let due = match (&a.due, &b.due) {
            (Some(a), Some(b)) => by_time(a, b),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        };
        due.then_with(|| a.title.cmp(&b.title))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn by_time(a: &str, b: &str) -> Ordering {
    match (parse_time(a), parse_time(b)) {
        (Some(a), Some(b)) => a.cmp(&b),
        _ => a.cmp(b),
    }
}

impl Status {
    pub(crate) fn admits(self, completed: bool) -> bool {
        match self {
            Status::Open => !completed,
            Status::Completed => completed,
            Status::All => true,
        }
    }
}
