//! Times as items carry them: RFC 3339 with an offset.

/// `ms` since the Unix epoch as RFC 3339 in UTC, to the second.
pub fn rfc3339(ms: u64) -> String {
    let secs = ms / 1000;
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (year, month, day) = civil(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3600,
        rest % 3600 / 60,
        rest % 60
    )
}

/// Whether `text` looks like an RFC 3339 time with an offset, as the index requires.
pub fn has_offset(text: &str) -> bool {
    let Some((date, time)) = text.split_once('T') else {
        return false;
    };
    if date.len() != 10 || time.len() < 6 {
        return false;
    }
    time.ends_with('Z') || time.ends_with('z') || {
        let zone = &time[time.len().saturating_sub(6)..];
        (zone.starts_with('+') || zone.starts_with('-')) && zone.as_bytes()[3] == b':'
    }
}

/// The date of a day number since 1970-01-01 (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_milliseconds_become_utc() {
        assert_eq!(rfc3339(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339(1_793_845_744_000), "2026-11-05T02:29:04Z");
        assert_eq!(rfc3339(951_782_400_000), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn offsets_are_required() {
        assert!(has_offset("2026-11-05T02:14:59.042Z"));
        assert!(has_offset("2026-11-05T11:14:59+09:00"));
        assert!(!has_offset("2026-11-05T11:14:59"));
        assert!(!has_offset("yesterday"));
    }
}
