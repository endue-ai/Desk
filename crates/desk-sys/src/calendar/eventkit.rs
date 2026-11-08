//! The macOS calendar source over EventKit: one `EKEventStore`, read only.
//!
//! This is the one module in desk-sys allowed `unsafe` (the workspace denies it everywhere else).
//! objc2's EventKit bindings mark every method `unsafe` because their generator cannot prove the
//! Objective-C contracts; each block here calls a getter, a predicate factory or a fetch with the
//! arguments EventKit documents. Nothing unsafe leaves the module: `EventKit` is a safe
//! `CalendarSource`, and no data call reaches the store before the OS grants read access.
//!
//! The app needs `NSCalendarsFullAccessUsageDescription` and `NSRemindersFullAccessUsageDescription`
//! in its Info.plist before it calls `request_access`; without them macOS ends the process.
#![allow(unsafe_code)]

use std::sync::{Mutex, MutexGuard, mpsc};
use std::time::Duration;

use block2::RcBlock;
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::Bool;
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStore, EKReminder};
use objc2_foundation::{NSArray, NSError};

use super::{
    Authorization, Calendar, CalendarSource, Event, Range, Reminder, Status, denied,
    sort_calendars, sort_events, sort_reminders,
};
use crate::{Error, ErrorCode};

mod convert;
mod rrule;

/// How long `reminders` waits for EventKit's fetch before it gives up.
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) struct EventKit {
    store: Mutex<Store>,
}

/// The store, used by one thread at a time through `EventKit::store`.
struct Store(Retained<EKEventStore>);

// SAFETY: `EKEventStore` has no thread affinity (EventKit's own documentation tells callers to run
// its synchronous queries off the main thread), and the mutex lets one thread at a time use it.
unsafe impl Send for Store {}

impl EventKit {
    pub(super) fn new() -> Self {
        // SAFETY: `new` is `[[EKEventStore alloc] init]`; it reads nothing and never prompts.
        let store = unsafe { EKEventStore::new() };
        Self {
            store: Mutex::new(Store(store)),
        }
    }

    fn store(&self) -> MutexGuard<'_, Store> {
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Ask for full access to one entity type; returns once EventKit's completion handler answers.
    fn request(&self, entity: EKEntityType) -> Result<(), Error> {
        let (sender, receiver) = mpsc::channel::<Option<String>>();
        let completion = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            // SAFETY: EventKit passes nil or an NSError that lives for the call.
            let message = unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());
            let _ = sender.send(message);
        });
        {
            let store = self.store();
            let completion = RcBlock::as_ptr(&completion);
            // SAFETY: `completion` is a live block of the handler's signature; EventKit copies it
            // and calls it once. The macOS 14 methods are only called where they exist.
            unsafe {
                if objc2::available!(macos = 14.0) {
                    if entity == EKEntityType::Event {
                        store.0.requestFullAccessToEventsWithCompletion(completion);
                    } else {
                        store
                            .0
                            .requestFullAccessToRemindersWithCompletion(completion);
                    }
                } else {
                    #[allow(deprecated)]
                    store
                        .0
                        .requestAccessToEntityType_completion(entity, completion);
                }
            }
        }
        drop(completion);
        match receiver.recv() {
            Ok(None) => Ok(()),
            Ok(Some(message)) => Err(Error::new(
                ErrorCode::IoError,
                format!("EventKit refused the access request: {message}"),
            )),
            Err(_) => Err(Error::new(
                ErrorCode::IoError,
                "EventKit dropped the access request without answering",
            )),
        }
    }
}

impl CalendarSource for EventKit {
    /// `FullAccess` when both calendars and reminders can be read. Otherwise `NotDetermined` if
    /// either was never asked, else the status of the first that cannot (calendars, then reminders).
    /// Each call checks its own entity type: events read with calendar access alone.
    fn authorization(&self) -> Authorization {
        combine(status(EKEntityType::Event), status(EKEntityType::Reminder))
    }

    fn request_access(&self) -> Result<Authorization, Error> {
        for entity in [EKEntityType::Event, EKEntityType::Reminder] {
            if status(entity) == Authorization::NotDetermined {
                self.request(entity)?;
            }
        }
        Ok(self.authorization())
    }

    /// The event calendars and the reminder lists the OS lets Desk read.
    fn calendars(&self) -> Result<Vec<Calendar>, Error> {
        let kinds = [EKEntityType::Event, EKEntityType::Reminder].map(|e| (e, status(e)));
        if !kinds.iter().any(|(_, status)| status.can_read()) {
            return Err(denied("calendars", combine(kinds[0].1, kinds[1].1)));
        }
        let store = self.store();
        let mut calendars = autoreleasepool(|_| {
            let mut calendars = Vec::new();
            for (entity, _) in kinds.iter().filter(|(_, status)| status.can_read()) {
                // SAFETY: lists the calendars of an entity type the OS lets Desk read.
                let found = unsafe { store.0.calendarsForEntityType(*entity) };
                calendars.extend(found.iter().map(|calendar| convert::calendar(&calendar)));
            }
            calendars
        });
        sort_calendars(&mut calendars);
        Ok(calendars)
    }

    /// EventKit answers at most four years from `from`.
    fn events(&self, from: &str, to: &str) -> Result<Vec<Event>, Error> {
        let range = Range::parse(from, to)?;
        let authorization = status(EKEntityType::Event);
        if !authorization.can_read() {
            return Err(denied("events", authorization));
        }
        if range.from == range.to {
            return Ok(Vec::new());
        }
        let store = self.store();
        let mut events = autoreleasepool(|_| {
            let (start, end) = (convert::ns_date(range.from), convert::ns_date(range.to));
            // SAFETY: the predicate comes from the store's own factory, which is what
            // `eventsMatchingPredicate` requires; `nil` calendars means all of them.
            let found = unsafe {
                let predicate = store
                    .0
                    .predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);
                store.0.eventsMatchingPredicate(&predicate)
            };
            found
                .iter()
                .filter_map(|event| convert::event(&event))
                .filter(|(start, end, _)| range.holds(*start, *end))
                .map(|(_, _, event)| event)
                .collect::<Vec<_>>()
        });
        sort_events(&mut events);
        Ok(events)
    }

    fn reminders(&self, status_wanted: Status) -> Result<Vec<Reminder>, Error> {
        let authorization = status(EKEntityType::Reminder);
        if !authorization.can_read() {
            return Err(denied("reminders", authorization));
        }
        let (sender, receiver) = mpsc::channel::<Vec<Reminder>>();
        let completion = RcBlock::new(move |found: *mut NSArray<EKReminder>| {
            // SAFETY: EventKit passes nil or an array of reminders that lives for the call.
            let found = unsafe { found.as_ref() };
            let reminders = autoreleasepool(|_| {
                found.map_or_else(Vec::new, |found| {
                    found.iter().map(|r| convert::reminder(&r)).collect()
                })
            });
            let _ = sender.send(reminders);
        });
        let fetch = {
            let store = self.store();
            autoreleasepool(|_| {
                // SAFETY: predicates from the store's own factories (`nil` dates and calendars mean
                // all of them), and a live block of the completion's signature, which EventKit
                // copies and calls once.
                unsafe {
                    let predicate = match status_wanted {
                        Status::Open => store
                            .0
                            .predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(
                                None, None, None,
                            ),
                        Status::Completed => store
                            .0
                            .predicateForCompletedRemindersWithCompletionDateStarting_ending_calendars(
                                None, None, None,
                            ),
                        Status::All => store.0.predicateForRemindersInCalendars(None),
                    };
                    store
                        .0
                        .fetchRemindersMatchingPredicate_completion(&predicate, &completion)
                }
            })
        };
        let mut reminders = match receiver.recv_timeout(FETCH_TIMEOUT) {
            Ok(reminders) => reminders,
            Err(_) => {
                // SAFETY: `fetch` is the identifier this store returned for the request.
                unsafe { self.store().0.cancelFetchRequest(&fetch) };
                return Err(Error::new(
                    ErrorCode::Timeout,
                    format!("EventKit did not answer the reminders fetch in {FETCH_TIMEOUT:?}"),
                ));
            }
        };
        reminders.retain(|reminder| status_wanted.admits(reminder.completed.is_some()));
        sort_reminders(&mut reminders);
        Ok(reminders)
    }
}

fn status(entity: EKEntityType) -> Authorization {
    // SAFETY: a class method that reads the status of an entity type; it never prompts.
    let status = unsafe { EKEventStore::authorizationStatusForEntityType(entity) };
    match status {
        // `Authorized` before macOS 14 is the same value.
        EKAuthorizationStatus::FullAccess => Authorization::FullAccess,
        EKAuthorizationStatus::WriteOnly => Authorization::WriteOnly,
        EKAuthorizationStatus::NotDetermined => Authorization::NotDetermined,
        EKAuthorizationStatus::Denied => Authorization::Denied,
        // `Restricted`, and any status a later macOS adds: not readable, and asking won't help.
        _ => Authorization::Restricted,
    }
}

fn combine(events: Authorization, reminders: Authorization) -> Authorization {
    if events.can_read() && reminders.can_read() {
        Authorization::FullAccess
    } else if events == Authorization::NotDetermined || reminders == Authorization::NotDetermined {
        Authorization::NotDetermined
    } else if !events.can_read() {
        events
    } else {
        reminders
    }
}
