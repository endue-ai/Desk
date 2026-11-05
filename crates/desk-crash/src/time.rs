//! A report's time: RFC 3339 in UTC with milliseconds (`at`), and the same as a file name
//! (`20261102T091500123Z`). No time crate: the civil date comes from days since the epoch.

use std::time::{SystemTime, UNIX_EPOCH};

/// Year, month, day, hour, minute, second and millisecond of `at` in UTC.
fn parts(at: SystemTime) -> (u64, u64, u64, u64, u64, u64, u64) {
    let ms = at
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    let (secs, ms) = (ms / 1000, ms % 1000);
    let z = secs / 86_400 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    let rest = secs % 86_400;
    (
        year,
        month,
        day,
        rest / 3600,
        rest % 3600 / 60,
        rest % 60,
        ms,
    )
}

/// `2026-11-02T09:15:00.123Z`.
pub fn rfc3339(at: SystemTime) -> String {
    let (y, mo, d, h, mi, s, ms) = parts(at);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{ms:03}Z")
}

/// `20261102T091500123Z`: sorts by time, safe in every file system.
pub fn stamp(at: SystemTime) -> String {
    let (y, mo, d, h, mi, s, ms) = parts(at);
    format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}{ms:03}Z")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn times_in_utc() {
        let at = UNIX_EPOCH + Duration::from_millis(1_793_000_000_123);
        assert_eq!(rfc3339(at), "2026-10-26T07:33:20.123Z");
        assert_eq!(stamp(at), "20261026T073320123Z");
    }
}
