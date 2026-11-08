//! A calendar source in memory, for tests here and in the crates above. It follows the same rules as
//! the OS source: nothing is read before authorization allows it, ranges are half-open RFC 3339, and
//! results are ordered the same way.

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::{
    Authorization, Calendar, CalendarSource, Event, Range, Reminder, Status, denied, parse_time,
    sort_calendars, sort_events, sort_reminders,
};
use crate::Error;

/// A `CalendarSource` over the calendars, events and reminders it was given. Starts with
/// `FullAccess`; `request_access` turns `NotDetermined` into the answer set by `with_answer`
/// (`FullAccess` unless changed) and leaves every other authorization as it is, as the OS does.
#[derive(Debug)]
pub struct FakeCalendar {
    authorization: Mutex<Authorization>,
    answer: Authorization,
    calendars: Vec<Calendar>,
    events: Vec<Event>,
    reminders: Vec<Reminder>,
    calls: AtomicUsize,
}

impl FakeCalendar {
    pub fn new() -> Self {
        Self {
            authorization: Mutex::new(Authorization::FullAccess),
            answer: Authorization::FullAccess,
            calendars: Vec::new(),
            events: Vec::new(),
            reminders: Vec::new(),
            calls: AtomicUsize::new(0),
        }
    }

    pub fn with_authorization(self, authorization: Authorization) -> Self {
        *self.authorization.lock().unwrap_or_else(|e| e.into_inner()) = authorization;
        self
    }

    /// What `request_access` answers when the person was never asked.
    pub fn with_answer(mut self, answer: Authorization) -> Self {
        self.answer = answer;
        self
    }

    pub fn with_calendars(mut self, calendars: Vec<Calendar>) -> Self {
        self.calendars = calendars;
        self
    }

    /// Events whose `start` or `end` does not parse are never in a range.
    pub fn with_events(mut self, events: Vec<Event>) -> Self {
        self.events = events;
        self
    }

    pub fn with_reminders(mut self, reminders: Vec<Reminder>) -> Self {
        self.reminders = reminders;
        self
    }

    /// How many `calendars`, `events` and `reminders` calls reached the data.
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    fn reach(&self, what: &str) -> Result<(), Error> {
        let authorization = self.authorization();
        if !authorization.can_read() {
            return Err(denied(what, authorization));
        }
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

impl Default for FakeCalendar {
    fn default() -> Self {
        Self::new()
    }
}

impl CalendarSource for FakeCalendar {
    fn authorization(&self) -> Authorization {
        *self.authorization.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn request_access(&self) -> Result<Authorization, Error> {
        let mut authorization = self.authorization.lock().unwrap_or_else(|e| e.into_inner());
        if *authorization == Authorization::NotDetermined {
            *authorization = self.answer;
        }
        Ok(*authorization)
    }

    fn calendars(&self) -> Result<Vec<Calendar>, Error> {
        self.reach("calendars")?;
        let mut calendars = self.calendars.clone();
        sort_calendars(&mut calendars);
        Ok(calendars)
    }

    fn events(&self, from: &str, to: &str) -> Result<Vec<Event>, Error> {
        let range = Range::parse(from, to)?;
        self.reach("events")?;
        let mut events: Vec<Event> = self
            .events
            .iter()
            .filter(
                |event| match (parse_time(&event.start), parse_time(&event.end)) {
                    (Some(start), Some(end)) => range.holds(start, end),
                    _ => false,
                },
            )
            .cloned()
            .collect();
        sort_events(&mut events);
        Ok(events)
    }

    fn reminders(&self, status: Status) -> Result<Vec<Reminder>, Error> {
        self.reach("reminders")?;
        let mut reminders: Vec<Reminder> = self
            .reminders
            .iter()
            .filter(|reminder| status.admits(reminder.completed.is_some()))
            .cloned()
            .collect();
        sort_reminders(&mut reminders);
        Ok(reminders)
    }
}
