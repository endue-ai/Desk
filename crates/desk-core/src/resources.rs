//! Work a caller started and owns: watches, processes and captures. Each entry remembers the caller
//! and the grant that allowed it, so revoking the grant or turning the plugin off ends it.

use std::collections::BTreeMap;

pub(crate) struct Entry<T> {
    pub caller: String,
    pub grant: String,
    pub value: T,
}

/// Entries by id. Ids are only meaningful to their caller: lookups check the owner.
pub(crate) struct Table<T> {
    prefix: &'static str,
    next: u64,
    entries: BTreeMap<String, Entry<T>>,
}

impl<T> Table<T> {
    pub fn new(prefix: &'static str) -> Self {
        Self {
            prefix,
            next: 0,
            entries: BTreeMap::new(),
        }
    }

    /// The id the next insert will use, so work can be started under its id before it is stored.
    pub fn next_id(&mut self) -> String {
        self.next += 1;
        format!("{}{}", self.prefix, self.next)
    }

    pub fn insert(&mut self, id: String, caller: &str, grant: &str, value: T) {
        self.entries.insert(
            id,
            Entry {
                caller: caller.to_owned(),
                grant: grant.to_owned(),
                value,
            },
        );
    }

    /// `caller`'s entry `id`. Another caller's id is as good as missing.
    pub fn get_mut(&mut self, caller: &str, id: &str) -> Option<&mut T> {
        self.entries
            .get_mut(id)
            .filter(|entry| entry.caller == caller)
            .map(|entry| &mut entry.value)
    }

    /// Remove an entry whatever its owner (the work ended on its own).
    pub fn forget(&mut self, id: &str) -> Option<T> {
        self.entries.remove(id).map(|entry| entry.value)
    }

    /// Remove every entry `ends` picks, and hand them back to be stopped.
    pub fn drain_where(&mut self, ends: impl Fn(&Entry<T>) -> bool) -> Vec<T> {
        let ids: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| ends(entry))
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter()
            .filter_map(|id| self.entries.remove(id))
            .map(|entry| entry.value)
            .collect()
    }
}
