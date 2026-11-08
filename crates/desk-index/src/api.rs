//! `ItemIndex`, the trait the core knows the index by (PKG-01): the core holds an
//! `Arc<dyn ItemIndex>` and never sees SQLite; `Index` is the implementation.

use std::sync::mpsc::Receiver;

use desk_bridge::{Item, ItemChange, ItemPage, ItemQuery, ItemSource};

use crate::{DataReadScope, Index, Limits, Result};

/// The item index as the core uses it. Each method is `Index`'s method of the same name.
pub trait ItemIndex: Send + Sync {
    fn upsert(&self, items: &[Item]) -> Result<()>;

    fn remove(&self, source: &ItemSource, ids: &[String]) -> Result<usize>;

    fn clear(&self, source: &ItemSource) -> Result<usize>;

    fn get(&self, source: &ItemSource, id: &str, allowed: &DataReadScope) -> Result<Option<Item>>;

    fn query(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<ItemPage>;

    fn count(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<u64>;

    fn subscribe(
        &self,
        query: &ItemQuery,
        allowed: &DataReadScope,
    ) -> Result<Receiver<Vec<ItemChange>>>;

    fn counts(&self) -> Result<Vec<(ItemSource, u64)>>;

    fn set_limits(&self, source: &ItemSource, limits: Limits);

    fn rebuild(&self) -> Result<()>;
}

impl ItemIndex for Index {
    fn upsert(&self, items: &[Item]) -> Result<()> {
        Index::upsert(self, items)
    }

    fn remove(&self, source: &ItemSource, ids: &[String]) -> Result<usize> {
        Index::remove(self, source, ids)
    }

    fn clear(&self, source: &ItemSource) -> Result<usize> {
        Index::clear(self, source)
    }

    fn get(&self, source: &ItemSource, id: &str, allowed: &DataReadScope) -> Result<Option<Item>> {
        Index::get(self, source, id, allowed)
    }

    fn query(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<ItemPage> {
        Index::query(self, query, allowed)
    }

    fn count(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<u64> {
        Index::count(self, query, allowed)
    }

    fn subscribe(
        &self,
        query: &ItemQuery,
        allowed: &DataReadScope,
    ) -> Result<Receiver<Vec<ItemChange>>> {
        Index::subscribe(self, query, allowed)
    }

    fn counts(&self) -> Result<Vec<(ItemSource, u64)>> {
        Index::counts(self)
    }

    fn set_limits(&self, source: &ItemSource, limits: Limits) {
        Index::set_limits(self, source, limits)
    }

    fn rebuild(&self) -> Result<()> {
        Index::rebuild(self)
    }
}
