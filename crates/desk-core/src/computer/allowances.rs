//! In-memory approval to operate one app for an agent in an active desk conversation.

use std::collections::{BTreeMap, BTreeSet};

use crate::conversation::BrainMode;

#[derive(Default)]
pub(crate) struct AppApprovals {
    session: Option<(BrainMode, String)>,
    turns: BTreeSet<String>,
    grants: BTreeMap<String, BTreeMap<String, String>>,
    generation: u64,
}

impl AppApprovals {
    pub(crate) fn enter(&mut self, turn: &str, mode: &BrainMode, session: &str) {
        if !self
            .session
            .as_ref()
            .is_some_and(|(m, s)| m == mode && s == session)
        {
            self.close();
            self.session = Some((mode.clone(), session.to_owned()));
        }
        self.turns.insert(turn.to_owned());
    }

    pub(crate) fn close(&mut self) {
        self.session = None;
        self.turns.clear();
        self.clear();
    }

    pub(crate) fn end_turn(&mut self, turn: &str) {
        self.turns.remove(turn);
    }

    pub(crate) fn clear(&mut self) {
        self.generation += 1;
        self.grants.clear();
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn offer(&self, turn: Option<&str>) -> Option<u64> {
        turn.filter(|turn| self.turns.contains(*turn))
            .map(|_| self.generation)
    }

    pub(crate) fn grant(&mut self, generation: u64, caller: &str, app: &str, id: &str) -> bool {
        if self.generation != generation {
            return false;
        }
        self.grants
            .entry(caller.to_owned())
            .or_default()
            .insert(app.to_owned(), id.to_owned());
        true
    }

    pub(crate) fn approved(&self, caller: &str, app: &str) -> Option<String> {
        self.grants.get(caller)?.get(app).cloned()
    }

    pub(crate) fn apps(&self, caller: &str) -> Vec<String> {
        self.grants
            .get(caller)
            .into_iter()
            .flat_map(|apps| apps.keys().cloned())
            .collect()
    }
}
