//! RFC 3339 times with an offset as epoch seconds: the `*_utc` columns, and the values `where`
//! compares them with, so instants compare across offsets.

/// Seconds since 1970-01-01T00:00:00Z of `YYYY-MM-DDTHH:MM:SS[.frac](Z|±HH:MM)`, the item spec's
/// `Timestamp`; fractions are dropped. `None` for anything else, a time without an offset included.
pub(crate) fn epoch_seconds(text: &str) -> Option<i64> {
    let b = text.as_bytes();
    if b.len() < 20
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> {
        let digits = b.get(from..to)?;
        digits.iter().try_fold(0i64, |n, d| {
            d.is_ascii_digit().then(|| n * 10 + i64::from(d - b'0'))
        })
    };
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let mut rest = &b[19..];
    if let Some(fraction) = rest.strip_prefix(b".") {
        let digits = fraction.iter().take_while(|d| d.is_ascii_digit()).count();
        if digits == 0 {
            return None;
        }
        rest = &fraction[digits..];
    }
    let offset = match rest {
        b"Z" => 0,
        [sign @ (b'+' | b'-'), h1, h2, b':', m1, m2] => {
            let digit = |d: &u8| d.is_ascii_digit().then(|| i64::from(d - b'0'));
            let (h, m) = (digit(h1)? * 10 + digit(h2)?, digit(m1)? * 10 + digit(m2)?);
            if h > 23 || m > 59 {
                return None;
            }
            if *sign == b'-' {
                -(h * 3600 + m * 60)
            } else {
                h * 3600 + m * 60
            }
        }
        _ => return None,
    };
    let valid = (1..=12).contains(&month)
        && day >= 1
        && day <= days_in_month(year, month)
        && hour <= 23
        && minute <= 59
        && second <= 60;
    valid.then(|| {
        days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset
    })
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::epoch_seconds;

    #[test]
    fn offsets_name_the_same_instant() {
        assert_eq!(epoch_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(epoch_seconds("2026-10-30T00:00:00Z"), Some(1_793_318_400));
        assert_eq!(
            epoch_seconds("2026-10-30T09:00:00+09:00"),
            Some(1_793_318_400)
        );
        assert_eq!(
            epoch_seconds("2026-10-29T19:30:00.250-04:30"),
            Some(1_793_318_400)
        );
        assert_eq!(epoch_seconds("1969-12-31T23:59:59Z"), Some(-1));
        assert_eq!(epoch_seconds("2024-02-29T00:00:00Z"), Some(1_709_164_800));
    }

    #[test]
    fn anything_but_an_rfc_3339_time_with_an_offset_is_refused() {
        for bad in [
            "2026-10-30T09:00:00",
            "2026-10-30 09:00:00Z",
            "2026-13-01T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-10-30T24:00:00Z",
            "2026-10-30T09:00:00.Z",
            "2026-10-30T09:00:00+0900",
            "2026-10-30T09:00:00+24:00",
            "２026-10-30T09:00:00Z",
            "",
        ] {
            assert_eq!(epoch_seconds(bad), None, "{bad}");
        }
    }
}
