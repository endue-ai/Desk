//! Time for the connector scheduler, injected so tests can move it, and RFC 3339 in UTC without a
//! date-time dependency (civil-from-days and days-from-civil, proleptic Gregorian calendar).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Where the connector host reads the time: `SystemClock` in the desk, a fake one in tests.
pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

/// The system's wall clock.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

/// `time` as RFC 3339 in UTC: `2026-10-30T00:00:00Z`, with milliseconds when there are any
/// (`2026-10-30T00:00:00.250Z`). Times before 1970 are written as 1970-01-01T00:00:00Z.
pub fn rfc3339(time: SystemTime) -> String {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = since.as_secs();
    let days = i64::try_from(secs / 86_400).unwrap_or(i64::MAX);
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    let (hour, minute, second) = (rem / 3_600, rem % 3_600 / 60, rem % 60);
    let millis = since.subsec_millis();
    let fraction = if millis == 0 {
        String::new()
    } else {
        format!(".{millis:03}")
    };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}{fraction}Z")
}

/// Read an RFC 3339 time with an offset (`Z`, `+09:00`) and an optional fraction, or `None`.
pub(crate) fn parse_rfc3339(text: &str) -> Option<SystemTime> {
    let bytes = text.as_bytes();
    let num = |from: usize, len: usize| -> Option<i64> {
        let part = text.get(from..from + len)?;
        part.bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| part.parse().ok())?
    };
    let fixed = [(4, b'-'), (7, b'-'), (13, b':'), (16, b':')];
    if bytes.len() < 20 || fixed.iter().any(|&(at, c)| bytes[at] != c) {
        return None;
    }
    if !matches!(bytes[10], b'T' | b't') {
        return None;
    }
    let (year, month, day) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (hour, minute, second) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 {
        return None;
    }
    let mut at = 19;
    let mut nanos = 0u32;
    if bytes.get(at) == Some(&b'.') {
        let digits = bytes[at + 1..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        if digits == 0 {
            return None;
        }
        let kept = text.get(at + 1..at + 1 + digits.min(9))?;
        nanos = format!("{kept:0<9}").parse().ok()?;
        at += 1 + digits;
    }
    let offset = match &bytes[at..] {
        [b'Z' | b'z'] => 0,
        [sign @ (b'+' | b'-'), _, _, b':', _, _] => {
            let minutes = num(at + 1, 2)? * 60 + num(at + 4, 2)?;
            if *sign == b'-' { -minutes } else { minutes }
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    let secs = days * 86_400 + hour * 3_600 + minute * 60 + second.min(59) - offset * 60;
    let secs = u64::try_from(secs).ok()?;
    Some(UNIX_EPOCH + Duration::new(secs, nanos))
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(secs: u64, millis: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_millis(secs * 1_000 + millis)
    }

    #[test]
    fn writes_and_reads_known_instants() {
        let cases = [
            (at(0, 0), "1970-01-01T00:00:00Z"),
            (at(951_782_400, 7), "2000-02-29T00:00:00.007Z"),
            (at(1_793_088_035, 250), "2026-10-27T08:00:35.250Z"),
            (at(1_793_318_400, 0), "2026-10-30T00:00:00Z"),
        ];
        for (time, text) in cases {
            assert_eq!(rfc3339(time), text);
            assert_eq!(parse_rfc3339(text), Some(time), "{text}");
        }
        let tokyo = parse_rfc3339("2026-10-30T09:00:00+09:00");
        assert_eq!(tokyo, Some(at(1_793_318_400, 0)));
        for bad in [
            "",
            "2026-10-30",
            "2026-10-30T00:00:00",
            "2026-13-01T00:00:00Z",
            "x",
        ] {
            assert_eq!(parse_rfc3339(bad), None, "{bad}");
        }
    }
}
