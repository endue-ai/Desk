//! Times as memory writes them: RFC 3339 in UTC with milliseconds, and the month an episode files
//! under. No time crate: the civil date comes from days since the epoch (Howard Hinnant's algorithm).

use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch; a time before it reads as the epoch.
pub fn millis(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// `2026-11-05T09:12:00.123Z`.
pub fn rfc3339(at: SystemTime) -> String {
    let ms = millis(at);
    let (secs, ms) = (ms / 1000, ms % 1000);
    let (year, month, day) = civil(secs / 86_400);
    let rest = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{ms:03}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// The month file an episode at `at` goes to: `2026-11`.
pub fn month(at: SystemTime) -> String {
    let (year, month, _) = civil(millis(at) / 1000 / 86_400);
    format!("{year:04}-{month:02}")
}

/// Year, month and day of `days` after 1970-01-01.
fn civil(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn writes_utc_with_milliseconds() {
        let at = UNIX_EPOCH + Duration::from_millis(1_793_000_000_123);
        assert_eq!(rfc3339(at), "2026-10-26T07:33:20.123Z");
        assert_eq!(month(at), "2026-10");
        assert_eq!(rfc3339(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        let leap = UNIX_EPOCH + Duration::from_secs(1_709_164_800); // 2024-02-29
        assert_eq!(&rfc3339(leap)[..10], "2024-02-29");
    }
}
