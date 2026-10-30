//! The local item index: `specs/item/v0` items in one SQLite file in the data folder, with FTS5
//! over title and body. Connectors put items in; views, search and agents read them, and every read
//! passes the caller's `data:read` scope inside the SQL, so a page is always full and never holds a
//! row the scope does not cover (ADR 0033). No permission checks happen here beyond that:
//! desk-core decides who holds which scope.

use std::path::Path;
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use desk_bridge::{Item, ItemChange, ItemPage, ItemQuery, ItemSource};
use rusqlite::{Connection, OptionalExtension};

mod api;
mod columns;
mod cursor;
mod error;
mod fields;
mod filter;
mod query;
mod retention;
mod schema;
mod scope;
mod sql;
mod store;
mod subscribe;
mod time;

pub use api::ItemIndex;
pub use error::{Error, ErrorCode, Result};
pub use query::{DEFAULT_LIMIT, MAX_LIMIT};
pub use retention::Limits;
pub use schema::SCHEMA_VERSION;
pub use scope::DataReadScope;

use columns::Key;
use sql::Sql;
use store::State;
use subscribe::Subscription;

pub const NAME: &str = env!("CARGO_PKG_NAME");

/// The index over one SQLite file. Calls are serialized; share it behind an `Arc`.
pub struct Index {
    state: Mutex<State>,
}

impl Index {
    /// Open or create the index file (and its folder), bringing it to `SCHEMA_VERSION`. A file a
    /// newer desk wrote is `unsupported`; any SQLite failure is `io_error`.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(folder) = path
            .parent()
            .filter(|folder| !folder.as_os_str().is_empty())
        {
            std::fs::create_dir_all(folder)?;
        }
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(Duration::from_secs(5))?;
        scope::register(&conn)?;
        schema::migrate(&mut conn)?;
        conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        Ok(Self {
            state: Mutex::new(State {
                conn,
                subs: Vec::new(),
                limits: Default::default(),
            }),
        })
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Insert or replace items by source and id, in one transaction, then apply each source's
    /// `Limits`. A known time field that is not RFC 3339 with an offset is `invalid_params`.
    pub fn upsert(&self, items: &[Item]) -> Result<()> {
        self.state().upsert(items)
    }

    /// Remove items of one source by id; answers how many were there.
    pub fn remove<I, S>(&self, source: &ItemSource, ids: I) -> Result<usize>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let keys = ids
            .into_iter()
            .map(|id| Key::new(source, id.as_ref()))
            .collect();
        self.state().remove(keys)
    }

    /// Remove every item of one source; answers how many there were.
    pub fn clear(&self, source: &ItemSource) -> Result<usize> {
        self.state().clear(source)
    }

    /// The item with this source and id, if the scope covers it.
    pub fn get(
        &self,
        source: &ItemSource,
        id: &str,
        allowed: &DataReadScope,
    ) -> Result<Option<Item>> {
        let mut sql = Sql::new("SELECT i.json FROM items i WHERE i.connector = ");
        sql.bind(source.connector.clone())
            .push(" AND i.instance = ")
            .bind(source.instance.clone())
            .push(" AND i.id = ")
            .bind(id.to_string());
        allowed.push_filter(&mut sql);
        let state = self.state();
        let json: Option<String> = state
            .conn
            .query_row(&sql.text, rusqlite::params_from_iter(&sql.params), |row| {
                row.get(0)
            })
            .optional()?;
        json.as_deref().map(columns::item).transpose()
    }

    /// One page of the items the query and the scope cover, in the query's order (newest
    /// `updatedAt` first by default, ties by id), after `query.cursor`.
    pub fn query(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<ItemPage> {
        query::page(&self.state().conn, query, allowed)
    }

    /// How many items the query and the scope cover, whatever its cursor and limit: the total of
    /// its pages.
    pub fn count(&self, query: &ItemQuery, allowed: &DataReadScope) -> Result<u64> {
        query::count(&self.state().conn, query, allowed)
    }

    /// Changes to the items the query's kinds, sources, text and where cover under the scope, one
    /// batch per write, sent before the write returns. An item that stops matching arrives as
    /// removed. Dropping the receiver ends the subscription at its next delivery.
    pub fn subscribe(
        &self,
        query: &ItemQuery,
        allowed: &DataReadScope,
    ) -> Result<Receiver<Vec<ItemChange>>> {
        let (sender, receiver) = channel();
        let subscription = Subscription::new(query, allowed, sender)?;
        self.state().subs.push(subscription);
        Ok(receiver)
    }

    /// Subscriptions still delivering.
    pub fn subscription_count(&self) -> usize {
        self.state().subs.len()
    }

    /// `(source, items)` for every source with items, by connector and instance.
    pub fn counts(&self) -> Result<Vec<(ItemSource, u64)>> {
        retention::counts(&self.state().conn)
    }

    /// The limits of one source from the next upsert on. They live in memory: the core sets them
    /// from the connector's settings after `open`.
    pub fn set_limits(&self, source: &ItemSource, limits: Limits) {
        let key = (source.connector.clone(), source.instance.clone());
        self.state().limits.insert(key, limits);
    }

    /// The limits of one source: `Limits::default()` until set.
    pub fn limits(&self, source: &ItemSource) -> Limits {
        let key = (source.connector.clone(), source.instance.clone());
        self.state().limits.get(&key).copied().unwrap_or_default()
    }

    /// Recreate the full-text table from the items and rebuild every index; the items are kept.
    pub fn rebuild(&self) -> Result<()> {
        schema::rebuild(&mut self.state().conn)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{DataReadScope, Index, ItemIndex};

    #[test]
    fn the_core_holds_the_index_behind_its_trait() {
        let dir = std::env::temp_dir().join(format!("desk-index-trait-{}", std::process::id()));
        let index: Arc<dyn ItemIndex> = Arc::new(Index::open(dir.join("index.sqlite")).unwrap());
        let item = serde_json::from_value(serde_json::json!({
            "id": "t1", "source": { "connector": "desk.fixtures", "instance": "default" },
            "kind": "task", "title": "Pay rent", "updatedAt": "2026-10-30T09:00:00Z", "status": "open",
        }))
        .unwrap();
        index.upsert(&[item]).unwrap();
        let all = DataReadScope::all();
        let query = serde_json::from_value(serde_json::json!({ "text": "rent" })).unwrap();
        assert_eq!(index.query(&query, &all).unwrap().items.len(), 1);
        let source = serde_json::from_value(serde_json::json!({
            "connector": "desk.fixtures", "instance": "default",
        }))
        .unwrap();
        assert_eq!(index.remove(&source, &["t1".to_string()]).unwrap(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
