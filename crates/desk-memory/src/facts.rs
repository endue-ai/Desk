//! Edits and conditional reversals of a single known fact.

use std::path::Path;

use crate::{Memory, MemoryError, MemoryFact, State, fact_row, files, time, words};

impl Memory {
    /// Change the words (and the tags, when given) of the fact `id`.
    pub fn edit(
        &self,
        id: &str,
        text: &str,
        tags: Option<Vec<String>>,
    ) -> Result<MemoryFact, MemoryError> {
        self.edit_with_previous(id, text, tags)
            .map(|(_, updated)| updated)
    }

    /// Edit and capture the previous fact while holding the same store lock.
    pub fn edit_with_previous(
        &self,
        id: &str,
        text: &str,
        tags: Option<Vec<String>>,
    ) -> Result<(MemoryFact, MemoryFact), MemoryError> {
        let text = words(text, 2000)?;
        let mut state = self.fresh()?;
        let at = time::rfc3339((self.clock)());
        let index = state
            .facts
            .iter()
            .position(|fact| fact.id == id)
            .ok_or_else(|| MemoryError::NotFound(format!("no fact {id}")))?;
        let mut updated = state.facts[index].clone();
        updated.text = text;
        updated.updated = Some(at);
        if let Some(tags) = tags {
            updated.tags = (!tags.is_empty()).then_some(tags);
        }
        let previous = std::mem::replace(&mut state.facts[index], updated.clone());
        if let Err(failure) = files::write_facts(&self.dir, &state.facts) {
            state.facts[index] = previous;
            return Err(failure);
        }
        index_fact(&self.dir, &mut state, &updated.id, Some(&updated));
        Ok((previous, updated))
    }

    /// Restore or remove a fact only while it still matches what the original call saved.
    pub fn undo_fact(
        &self,
        saved: &MemoryFact,
        previous: Option<&MemoryFact>,
    ) -> Result<(), MemoryError> {
        let mut state = self.fresh()?;
        let index = state
            .facts
            .iter()
            .position(|fact| fact == saved)
            .ok_or_else(|| {
                MemoryError::NotFound("This fact changed after it was saved".to_owned())
            })?;
        if previous.is_some_and(|fact| fact.id != saved.id) {
            return Err(MemoryError::Invalid(
                "The fact stays under its original id".to_owned(),
            ));
        }
        let mut facts = state.facts.clone();
        match previous {
            Some(previous) => facts[index] = previous.clone(),
            None => {
                facts.remove(index);
            }
        }
        files::write_facts(&self.dir, &facts)?;
        state.facts = facts;
        index_fact(&self.dir, &mut state, &saved.id, previous);
        Ok(())
    }
}

/// The file is authoritative. A failed index update is rebuilt on the next read.
pub(super) fn index_fact(dir: &Path, state: &mut State, id: &String, fact: Option<&MemoryFact>) {
    let seen = files::fingerprint(dir);
    let indexed = match fact {
        Some(fact) => state.index.put(&fact_row(fact), &seen),
        None => state.index.remove(std::slice::from_ref(id), &seen),
    };
    if indexed.is_ok() {
        state.seen = seen;
    } else {
        state.seen.clear();
    }
}
