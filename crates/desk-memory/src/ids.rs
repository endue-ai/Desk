//! Memory ids: `fact_` or `ep_`, then the time in base 36 (nine digits, so ids sort by when they were
//! made), a sequence for ids made in the same millisecond, and random digits so two desks never pick
//! the same id before sync exists.

use std::sync::Mutex;

/// The last millisecond an id was made in, and how many were made in it.
static LAST: Mutex<(u64, u64)> = Mutex::new((0, 0));

const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// A new id with `prefix` (`fact` or `ep`) for a time of `millis`.
pub fn new_id(prefix: &str, millis: u64) -> String {
    let (at, seq) = {
        let mut last = LAST.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // Never behind the last id, so a clock that steps back still sorts new ids last.
        let at = millis.max(last.0);
        let seq = if at == last.0 { last.1 + 1 } else { 0 };
        *last = (at, seq);
        (at, seq)
    };
    let mut random = [0u8; 6];
    let _ = getrandom::fill(&mut random);
    let tail: String = random
        .iter()
        .map(|b| char::from(DIGITS[usize::from(*b) % 36]))
        .collect();
    format!("{prefix}_{}{}{tail}", base36(at, 9), base36(seq, 3))
}

/// The part after the prefix, which orders ids of either kind by when they were made.
pub fn order(id: &str) -> &str {
    id.split_once('_').map_or(id, |(_, rest)| rest)
}

fn base36(mut n: u64, width: usize) -> String {
    let mut out = vec![b'0'; width];
    for slot in out.iter_mut().rev() {
        *slot = DIGITS[(n % 36) as usize];
        n /= 36;
    }
    String::from_utf8(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_made_in_one_millisecond_still_sort_in_order() {
        let a = new_id("fact", 1_793_000_000_000);
        let b = new_id("ep", 1_793_000_000_000);
        let c = new_id("fact", 1_793_000_000_000);
        assert!(
            order(&a) < order(&b) && order(&b) < order(&c),
            "{a} {b} {c}"
        );
        assert!(
            a.starts_with("fact_") && a.len() == "fact_".len() + 18,
            "{a}"
        );
    }
}
