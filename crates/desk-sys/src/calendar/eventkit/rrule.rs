//! An `EKRecurrenceRule` as an RFC 5545 RRULE value: `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10`.

use objc2_event_kit::{EKRecurrenceFrequency, EKRecurrenceRule, EKWeekday};
use objc2_foundation::{NSArray, NSNumber};
use time::UtcOffset;

use super::convert::instant;

const WEEKDAYS: [&str; 7] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

pub(super) fn render(rule: &EKRecurrenceRule) -> String {
    let mut parts = Vec::new();
    // SAFETY: getters of a rule the store returned.
    unsafe {
        let frequency = match rule.frequency() {
            EKRecurrenceFrequency::Daily => "DAILY",
            EKRecurrenceFrequency::Weekly => "WEEKLY",
            EKRecurrenceFrequency::Monthly => "MONTHLY",
            _ => "YEARLY",
        };
        parts.push(format!("FREQ={frequency}"));
        if rule.interval() > 1 {
            parts.push(format!("INTERVAL={}", rule.interval()));
        }
        if let Some(days) = rule.daysOfTheWeek().filter(|days| !days.is_empty()) {
            let days: Vec<String> = days
                .iter()
                .map(|day| {
                    let name = weekday(day.dayOfTheWeek());
                    match day.weekNumber() {
                        0 => name.to_owned(),
                        week => format!("{week}{name}"),
                    }
                })
                .collect();
            parts.push(format!("BYDAY={}", days.join(",")));
        }
        let lists = [
            ("BYMONTHDAY", rule.daysOfTheMonth()),
            ("BYYEARDAY", rule.daysOfTheYear()),
            ("BYWEEKNO", rule.weeksOfTheYear()),
            ("BYMONTH", rule.monthsOfTheYear()),
            ("BYSETPOS", rule.setPositions()),
        ];
        for (name, values) in lists {
            if let Some(values) = values.as_deref().and_then(numbers) {
                parts.push(format!("{name}={values}"));
            }
        }
        if (1..=7).contains(&rule.firstDayOfTheWeek()) {
            parts.push(format!(
                "WKST={}",
                weekday(EKWeekday(rule.firstDayOfTheWeek()))
            ));
        }
        if let Some(end) = rule.recurrenceEnd() {
            match end.endDate().as_deref().and_then(instant) {
                Some(until) => {
                    let until = until.to_offset(UtcOffset::UTC);
                    parts.push(format!(
                        "UNTIL={:04}{:02}{:02}T{:02}{:02}{:02}Z",
                        until.year(),
                        u8::from(until.month()),
                        until.day(),
                        until.hour(),
                        until.minute(),
                        until.second()
                    ));
                }
                None if end.occurrenceCount() > 0 => {
                    parts.push(format!("COUNT={}", end.occurrenceCount()));
                }
                None => {}
            }
        }
    }
    parts.join(";")
}

fn weekday(day: EKWeekday) -> &'static str {
    usize::try_from(day.0 - 1)
        .ok()
        .and_then(|index| WEEKDAYS.get(index))
        .copied()
        .unwrap_or("MO")
}

fn numbers(values: &NSArray<NSNumber>) -> Option<String> {
    let values: Vec<String> = values
        .iter()
        .map(|value| value.integerValue().to_string())
        .collect();
    (!values.is_empty()).then(|| values.join(","))
}
