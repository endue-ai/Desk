//! EventKit objects to the plain structs of `calendar`: ids, titles, RFC 3339 times in the local
//! offset, `#rrggbb` colors. Getters that EventKit may answer with nil are read as optional.

use objc2::msg_send;
use objc2::rc::Retained;
use objc2_app_kit::{NSColor, NSColorSpace};
use objc2_event_kit::{EKCalendar, EKCalendarItem, EKEvent, EKReminder};
use objc2_foundation::{
    NSCalendar, NSCalendarIdentifierGregorian, NSDate, NSDateComponents, NSTimeZone,
};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use super::rrule;
use crate::calendar::{Calendar, Event, Reminder};

pub(super) fn ns_date(time: OffsetDateTime) -> Retained<NSDate> {
    NSDate::dateWithTimeIntervalSince1970(time.unix_timestamp_nanos() as f64 / 1e9)
}

/// The instant of `date` in the local offset of that moment, to the second.
pub(super) fn instant(date: &NSDate) -> Option<OffsetDateTime> {
    let seconds = date.timeIntervalSince1970();
    if !seconds.is_finite() {
        return None;
    }
    // Whole minutes: RFC 3339 has no seconds in an offset (old local mean times had them).
    let offset = NSTimeZone::localTimeZone().secondsFromGMTForDate(date) / 60 * 60;
    let offset = UtcOffset::from_whole_seconds(i32::try_from(offset).ok()?).ok()?;
    let time = OffsetDateTime::from_unix_timestamp(seconds.round() as i64).ok()?;
    Some(time.to_offset(offset))
}

pub(super) fn rfc3339(time: OffsetDateTime) -> Option<String> {
    time.format(&Rfc3339).ok()
}

fn date_text(date: Option<&NSDate>) -> Option<String> {
    date.and_then(instant).and_then(rfc3339)
}

pub(super) fn calendar(calendar: &EKCalendar) -> Calendar {
    // SAFETY: getters of a calendar the store returned. `color` is read through `msg_send!` as an
    // optional so a calendar without one is `None` rather than a panic.
    unsafe {
        let color: Option<Retained<NSColor>> = msg_send![calendar, color];
        Calendar {
            id: calendar.calendarIdentifier().to_string(),
            title: calendar.title().to_string(),
            color: color.as_deref().and_then(hex),
        }
    }
}

/// An event with the instants it spans, or `None` if EventKit gave it no dates.
pub(super) fn event(event: &EKEvent) -> Option<(OffsetDateTime, OffsetDateTime, Event)> {
    // SAFETY: getters of an event the store returned. The dates are read as optionals: EventKit
    // declares them `null_unspecified`.
    unsafe {
        let start: Option<Retained<NSDate>> = msg_send![event, startDate];
        let end: Option<Retained<NSDate>> = msg_send![event, endDate];
        let start = instant(start.as_deref()?)?;
        let end = instant(end.as_deref()?)?.max(start);
        let item: &EKCalendarItem = event;
        let converted = Event {
            id: item.calendarItemIdentifier().to_string(),
            calendar: calendar_id(item),
            title: item.title().to_string(),
            start: rfc3339(start)?,
            end: rfc3339(end)?,
            all_day: event.isAllDay(),
            location: item
                .location()
                .map(|l| l.to_string())
                .filter(|l| !l.is_empty()),
            recurrence: recurrence(item),
        };
        Some((start, end, converted))
    }
}

pub(super) fn reminder(reminder: &EKReminder) -> Reminder {
    // SAFETY: getters of a reminder the store returned.
    unsafe {
        let item: &EKCalendarItem = reminder;
        let completed = if reminder.isCompleted() {
            let when = reminder
                .completionDate()
                .or_else(|| item.lastModifiedDate())
                .or_else(|| item.creationDate());
            date_text(when.as_deref())
        } else {
            None
        };
        Reminder {
            id: item.calendarItemIdentifier().to_string(),
            list: calendar_id(item),
            title: item.title().to_string(),
            due: reminder.dueDateComponents().and_then(|c| due(&c)),
            completed,
            priority: priority(reminder.priority()),
        }
    }
}

/// EventKit's 1-9 (1-4 high, 5 medium, 6-9 low; 0 none) as `specs/item/v0`'s 1 (high) to 4.
fn priority(value: usize) -> Option<u8> {
    match value {
        1..=4 => Some(1),
        5 => Some(2),
        6..=9 => Some(3),
        _ => None,
    }
}

/// A due date: the components' own calendar if they carry one, else Gregorian in their time zone
/// (or the local one). A date without a time is midnight.
fn due(components: &NSDateComponents) -> Option<String> {
    let date = components.date().or_else(|| {
        // SAFETY: a constant Foundation exports.
        let gregorian =
            NSCalendar::calendarWithIdentifier(unsafe { NSCalendarIdentifierGregorian })?;
        if let Some(zone) = components.timeZone() {
            gregorian.setTimeZone(&zone);
        }
        gregorian.dateFromComponents(components)
    });
    date_text(date.as_deref())
}

fn calendar_id(item: &EKCalendarItem) -> String {
    // SAFETY: getters of an item the store returned.
    unsafe { item.calendar() }
        .map(|calendar| unsafe { calendar.calendarIdentifier() }.to_string())
        .unwrap_or_default()
}

fn recurrence(item: &EKCalendarItem) -> Option<String> {
    // SAFETY: getters of an item the store returned.
    let rules = unsafe { item.recurrenceRules() }?;
    rules.iter().next().map(|rule| rrule::render(&rule))
}

fn hex(color: &NSColor) -> Option<String> {
    let srgb = color.colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
    let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel(srgb.redComponent()),
        channel(srgb.greenComponent()),
        channel(srgb.blueComponent()),
    ))
}
