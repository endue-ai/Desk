//! A desk whose own page stopped painting starts again (ADR 0202). The watch (`web_host/stall.rs`)
//! finds the desk's page without frames; loading that page again would restart the runtime under
//! every plugin's page, so the desk quits the way the person's quit does (`quit.rs`, asking the page
//! first: nothing unsaved, nothing lost) and starts a new desk, which brings back what this one kept
//! (its windows, ADR 0189). The new desk hears [`ENV`]: when the start before it was a stall's, less
//! than [`BETWEEN`] ago, a stall of its own is only reported, so a stall that comes back at once
//! cannot restart the desk over and over.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The environment variable a desk started for a stall hears: when that start was, in seconds since
/// the Unix epoch.
pub const ENV: &str = "DESK_STALL_RESTART";
/// The least time between two starts for a stall.
pub const BETWEEN: Duration = Duration::from_secs(10 * 60);

/// Whether a desk may start again for a stall at `now`, given `last` (the value of [`ENV`] it was
/// started with, if any).
pub fn may(last: Option<&str>, now: SystemTime) -> bool {
    let Some(last) = last.and_then(|text| text.trim().parse::<u64>().ok()) else {
        return true;
    };
    let last = UNIX_EPOCH + Duration::from_secs(last);
    now.duration_since(last).is_ok_and(|since| since >= BETWEEN)
}

/// The value of [`ENV`] for a desk started at `now`.
pub fn mark(now: SystemTime) -> String {
    now.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

/// Start a new desk for a stall, once `release` let go of what it needs first, and end this one.
pub fn relaunch(release: impl FnOnce()) {
    eprintln!("endue Desk: starting a new desk, as this one's page stopped painting (ADR 0202)");
    desk_boot::start::relaunch_with(release, &[(ENV, mark(SystemTime::now()))]);
}

#[cfg(test)]
mod tests {
    use super::{BETWEEN, mark, may};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn a_desk_started_by_the_person_may_start_again_for_a_stall() {
        let now = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        assert!(may(None, now));
        assert!(may(Some(""), now), "an unreadable mark counts as none");
        assert!(may(Some("soon"), now));
    }

    #[test]
    fn a_stall_soon_after_a_start_for_a_stall_does_not_start_the_desk_again() {
        let started = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let last = mark(started);
        assert_eq!(last, "1800000000");
        assert!(!may(Some(&last), started + Duration::from_secs(5)));
        assert!(!may(
            Some(&last),
            started + BETWEEN - Duration::from_secs(1)
        ));
        assert!(may(Some(&last), started + BETWEEN));
        // A clock set back: the mark is in the future, so the desk does not start again.
        assert!(!may(Some(&last), started - Duration::from_secs(60)));
    }
}
