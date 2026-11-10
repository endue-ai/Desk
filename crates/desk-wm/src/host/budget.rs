//! The live budget on the compositor (#37, ADR 0134, ADR 0142; ported from
//! `packages/runtime/src/frames/live-budget.ts` and the decisions of `frames/policy.ts`): every
//! window in sight, or with the keys, keeps a renderer; of those out of sight, the N most recently
//! focused do (`desk.surfaces.live`), and one hidden for `desk.display.unload-after` goes even
//! inside them. The rest sleep: their state is kept and a placeholder stands in until they show.
//! Recency is focus order: a window that opens, takes the keys or is woken for an answer is the
//! most recent. Decisions only, times passed in: whoever holds the surfaces carries them out (the
//! runtime asks for `desk:state` and takes the frame away, ADR 0156) and says what became of them.

use std::collections::{BTreeMap, BTreeSet};

/// One window the budget counts.
#[derive(Clone, Debug, Default)]
struct Entry {
    /// Its renderer is gone (asleep or stopped), as its holder last said.
    asleep: bool,
    /// When it went out of sight; `None` while it is in sight.
    hidden_since: Option<f64>,
}

/// What the budget decided.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Decision {
    /// The windows that keep a renderer: those in sight or with the keys, and the most recent out
    /// of sight within the budget.
    pub keep: BTreeSet<String>,
    /// In sight (or with the keys) but asleep: to wake.
    pub wake: Vec<String>,
    /// Live and out of the set, least recent first: to put to sleep.
    pub sleep: Vec<String>,
    /// When to look again: the next live window out of sight whose time runs out.
    pub next: Option<f64>,
}

/// The windows counted, most recent first, and what each is doing.
#[derive(Clone, Debug, Default)]
pub struct LiveBudget {
    order: Vec<String>,
    entries: BTreeMap<String, Entry>,
    /// The last decision's set, to tell a window woken by its holder (for an answer) from one the
    /// budget woke.
    kept: BTreeSet<String>,
}

impl LiveBudget {
    pub fn new() -> LiveBudget {
        LiveBudget::default()
    }

    /// Count `id` in, as the most recent: it just opened. False when it is counted already.
    pub fn track(&mut self, id: &str) -> bool {
        if self.entries.contains_key(id) {
            return false;
        }
        self.entries.insert(id.to_string(), Entry::default());
        self.touch(id);
        true
    }

    /// Stop counting `id`: its window closed or it is gone.
    pub fn untrack(&mut self, id: &str) {
        self.entries.remove(id);
        self.order.retain(|other| other != id);
        self.kept.remove(id);
    }

    /// `id` took the keys, or was woken for an answer: it is the most recent now.
    pub fn touch(&mut self, id: &str) {
        if !self.entries.contains_key(id) || self.order.first().is_some_and(|f| f == id) {
            return;
        }
        self.order.retain(|other| other != id);
        self.order.insert(0, id.to_string());
    }

    /// Whether `id` is counted.
    pub fn tracks(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    /// The windows counted, most recent first.
    pub fn order(&self) -> &[String] {
        &self.order
    }

    /// What `id`'s holder says of it: asleep (no renderer) or live. A window that comes back live
    /// while the budget did not keep it was woken for something that waits on it: the most recent.
    pub fn reported(&mut self, id: &str, asleep: bool) {
        let woke_itself = !asleep && !self.kept.contains(id);
        let Some(entry) = self.entries.get_mut(id) else {
            return;
        };
        let was = entry.asleep;
        entry.asleep = asleep;
        if was && woke_itself {
            self.touch(id);
            self.kept.insert(id.to_string());
        }
    }

    /// Whether `id` sleeps, as its holder last said.
    pub fn asleep(&self, id: &str) -> bool {
        self.entries.get(id).is_some_and(|e| e.asleep)
    }

    /// Look at every window again at `now` (ms): `shown` are the windows in sight, `focused` the
    /// one with the keys, `budget` how many out of sight may stay live (0 keeps only what is in
    /// sight), `after_ms` how long one may stay out of sight live (0: as long as the budget lets it).
    pub fn decide(
        &mut self,
        shown: &BTreeSet<String>,
        focused: Option<&str>,
        budget: usize,
        after_ms: f64,
        now: f64,
    ) -> Decision {
        if let Some(id) = focused {
            self.touch(id);
        }
        let in_sight = |id: &str| shown.contains(id) || focused == Some(id);
        for (id, entry) in &mut self.entries {
            if in_sight(id) {
                entry.hidden_since = None;
            } else if entry.hidden_since.is_none() {
                entry.hidden_since = Some(now);
            }
        }
        let mut decision = Decision::default();
        let mut hidden_live = Vec::new();
        for id in &self.order {
            let entry = &self.entries[id];
            if in_sight(id) {
                decision.keep.insert(id.clone());
                if entry.asleep {
                    decision.wake.push(id.clone());
                }
                continue;
            }
            if entry.asleep {
                continue;
            }
            let since = entry.hidden_since.unwrap_or(now);
            if after_ms > 0.0 && now - since >= after_ms {
                decision.sleep.push(id.clone());
            } else {
                hidden_live.push((id.clone(), since));
            }
        }
        for (i, (id, since)) in hidden_live.into_iter().enumerate() {
            if i < budget {
                if after_ms > 0.0 {
                    let due = since + after_ms;
                    decision.next = Some(decision.next.map_or(due, |n: f64| n.min(due)));
                }
                decision.keep.insert(id);
            } else {
                decision.sleep.push(id);
            }
        }
        // Least recent first, as the runtime's budget takes them.
        let rank = |id: &String| self.order.iter().position(|o| o == id).unwrap_or(0);
        decision.sleep.sort_by_key(|id| std::cmp::Reverse(rank(id)));
        self.kept = decision.keep.clone();
        decision
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(ids: &[&str]) -> BTreeSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn past_the_budget_the_least_recent_out_of_sight_sleep() {
        let mut b = LiveBudget::new();
        for id in ["a", "b", "c", "d"] {
            b.track(id);
        }
        let d = b.decide(&set(&["a"]), None, 2, 0.0, 0.0);
        assert_eq!(d.keep, set(&["a", "c", "d"]));
        assert_eq!(d.sleep, vec!["b".to_string()]);
        assert!(d.wake.is_empty());
    }

    #[test]
    fn hidden_too_long_a_window_sleeps_even_inside_the_budget() {
        let mut b = LiveBudget::new();
        b.track("a");
        b.track("b");
        let d = b.decide(&set(&["b"]), None, 8, 1000.0, 0.0);
        assert_eq!((d.sleep.len(), d.next), (0, Some(1000.0)));
        let d = b.decide(&set(&["b"]), None, 8, 1000.0, 1000.0);
        assert_eq!(d.sleep, vec!["a".to_string()]);
    }

    #[test]
    fn a_window_woken_by_its_holder_is_the_most_recent() {
        let mut b = LiveBudget::new();
        for id in ["a", "b", "c"] {
            b.track(id);
        }
        b.reported("a", true);
        b.decide(&set(&[]), None, 1, 0.0, 0.0);
        assert_eq!(b.order()[0], "c");
        b.reported("a", false);
        assert_eq!(b.order()[0], "a");
        let d = b.decide(&set(&[]), None, 1, 0.0, 0.0);
        assert_eq!(d.keep, set(&["a"]));
    }
}
