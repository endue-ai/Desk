//! The local item index: `specs/item/v0` items in one SQLite file in the data folder, with FTS5 over
//! title and body. Connectors put items in; views, search and agents read them, and every read passes
//! the caller's `data:read` scope inside the SQL (ADR 0033).

use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{Item, ItemChange, ItemPage, ItemQuery, ItemSource};

mod error;
mod scope;

pub use error::{Error, ErrorCode, Result};
pub use scope::DataReadScope;

pub const NAME: &str = env!("CARGO_PKG_NAME");

/// The schema version this build writes, kept in `PRAGMA user_version`.
pub const SCHEMA_VERSION: u32 = 1;

/// How much of one source (connector and instance) the index keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The most items kept; past it the oldest `updatedAt` go first.
    pub max_items: u64,
    /// Items not updated for this many days are dropped; `None` keeps them.
    pub keep_days: Option<u32>,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_items: 50_000,
            keep_days: None,
        }
    }
}

/// The index over one SQLite file.
pub struct Index {}

fn missing() -> Error {
    Error::new(ErrorCode::Unsupported, "not implemented yet")
}

impl Index {
    pub fn open(_path: impl AsRef<Path>) -> Result<Self> {
        Ok(Self {})
    }

    pub fn upsert(&self, _items: &[Item]) -> Result<()> {
        Err(missing())
    }

    pub fn remove<I, S>(&self, _source: &ItemSource, _ids: I) -> Result<usize>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Err(missing())
    }

    pub fn clear(&self, _source: &ItemSource) -> Result<usize> {
        Err(missing())
    }

    pub fn get(
        &self,
        _source: &ItemSource,
        _id: &str,
        _allowed: &DataReadScope,
    ) -> Result<Option<Item>> {
        Err(missing())
    }

    pub fn query(&self, _query: &ItemQuery, _allowed: &DataReadScope) -> Result<ItemPage> {
        Err(missing())
    }

    pub fn count(&self, _query: &ItemQuery, _allowed: &DataReadScope) -> Result<u64> {
        Err(missing())
    }

    pub fn subscribe(
        &self,
        _query: &ItemQuery,
        _allowed: &DataReadScope,
    ) -> Result<Receiver<Vec<ItemChange>>> {
        Err(missing())
    }

    pub fn subscription_count(&self) -> usize {
        0
    }

    pub fn counts(&self) -> Result<Vec<(ItemSource, u64)>> {
        Err(missing())
    }

    pub fn set_limits(&self, _source: &ItemSource, _limits: Limits) {}

    pub fn limits(&self, _source: &ItemSource) -> Limits {
        Limits::default()
    }

    pub fn rebuild(&self) -> Result<()> {
        Err(missing())
    }
}
