//! Where the connector host hands what connectors bring in: the desk's index (desk-index, wired by
//! desk-core) behind this trait, a recording sink in tests.

use desk_bridge::{Item, ItemSource};

/// The index's side of a sync. Each sync round makes at most one `upsert`, then at most one
/// `remove`; removing an instance makes one `clear`. An error fails the round (the cursor stays,
/// and the instance goes to `error` with the message), as a guest error does.
pub trait IndexSink: Send + Sync {
    /// Add or replace these items, keyed by their `source` and `id`. Every item is one of the
    /// instance's, checked against specs/item/v0's `Item` shape.
    fn upsert(&self, items: &[Item]) -> Result<(), String>;
    /// Drop the items of `source` with these ids.
    fn remove(&self, source: &ItemSource, ids: &[String]) -> Result<(), String>;
    /// Drop every item of `source`.
    fn clear(&self, source: &ItemSource) -> Result<(), String>;
}
