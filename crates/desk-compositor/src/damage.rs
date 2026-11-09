//! The damage log: every scene change records the screen region it touched, numbered, so each
//! renderer can ask what changed since the frame it last drew without the scene knowing about it.

use crate::types::Rect;
use std::collections::VecDeque;

/// How many changes the log remembers; asking about an older revision answers "everything".
const KEEP: usize = 256;

#[derive(Debug, Default)]
pub(crate) struct DamageLog {
    revision: u64,
    entries: VecDeque<(u64, Rect)>,
    /// The newest revision dropped from `entries`.
    forgotten: u64,
}

impl DamageLog {
    /// A log whose first revision damages `full`, so the first frame draws.
    pub fn new(full: Rect) -> DamageLog {
        let mut log = DamageLog::default();
        log.push(Some(full));
        log
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Record a change to `region`; an empty or off-screen one (`None`) changes nothing visible.
    pub fn push(&mut self, region: Option<Rect>) {
        let Some(region) = region.filter(|r| !r.is_empty()) else {
            return;
        };
        self.revision += 1;
        if self.entries.len() == KEEP
            && let Some((dropped, _)) = self.entries.pop_front()
        {
            self.forgotten = dropped;
        }
        self.entries.push_back((self.revision, region));
    }

    /// The union of what changed after `revision`, `None` when nothing did; `full` when the log no
    /// longer remembers that far back.
    pub fn since(&self, revision: u64, full: Rect) -> Option<Rect> {
        if revision >= self.revision {
            return None;
        }
        if revision < self.forgotten {
            return Some(full);
        }
        self.entries
            .iter()
            .filter(|(r, _)| *r > revision)
            .map(|(_, rect)| *rect)
            .reduce(|a, b| a.union(&b))
            .and_then(|r| r.intersect(&full))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: Rect = Rect::new(0.0, 0.0, 100.0, 100.0);

    #[test]
    fn a_new_log_damages_everything_once() {
        let log = DamageLog::new(FULL);
        assert_eq!(log.since(0, FULL), Some(FULL));
        assert_eq!(log.since(log.revision(), FULL), None);
    }

    #[test]
    fn regions_since_a_revision_are_unioned() {
        let mut log = DamageLog::new(FULL);
        let seen = log.revision();
        log.push(Some(Rect::new(0.0, 0.0, 10.0, 10.0)));
        log.push(None);
        log.push(Some(Rect::new(20.0, 20.0, 10.0, 10.0)));
        assert_eq!(log.revision(), seen + 2, "nothing visible, no revision");
        assert_eq!(log.since(seen, FULL), Some(Rect::new(0.0, 0.0, 30.0, 30.0)));
        assert_eq!(
            log.since(seen + 1, FULL),
            Some(Rect::new(20.0, 20.0, 10.0, 10.0))
        );
    }

    #[test]
    fn a_forgotten_revision_answers_everything() {
        let mut log = DamageLog::new(FULL);
        for _ in 0..KEEP + 5 {
            log.push(Some(Rect::new(1.0, 1.0, 1.0, 1.0)));
        }
        assert_eq!(log.since(1, FULL), Some(FULL));
        assert_eq!(
            log.since(log.revision() - 1, FULL),
            Some(Rect::new(1.0, 1.0, 1.0, 1.0))
        );
    }
}
