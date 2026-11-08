//! Subscriptions: after each write, the keys it touched are asked again with every subscription's
//! query and scope in SQL, before and after, and each subscriber gets one batch of its changes.

use std::collections::{HashMap, HashSet};
use std::sync::mpsc::Sender;

use desk_bridge::{
    ItemChange, ItemQuery, ItemRemoved, ItemRemovedChange, ItemUpserted, ItemUpsertedChange,
};
use rusqlite::{Connection, params};

use crate::columns::{Key, item};
use crate::error::Result;
use crate::query::filter;
use crate::scope::DataReadScope;
use crate::sql::Sql;

pub(crate) struct Subscription {
    /// The `WHERE` of its query and scope; sort, cursor and limit play no part.
    filter: Sql,
    sender: Sender<Vec<ItemChange>>,
}

impl Subscription {
    pub fn new(
        query: &ItemQuery,
        scope: &DataReadScope,
        sender: Sender<Vec<ItemChange>>,
    ) -> Result<Self> {
        let narrowing = ItemQuery {
            sort: None,
            cursor: None,
            limit: None,
            ..query.clone()
        };
        Ok(Self {
            filter: filter(&narrowing, scope)?,
            sender,
        })
    }
}

/// What every subscription saw of a write's keys before it.
pub(crate) struct Watch {
    before: Vec<HashSet<Key>>,
}

impl Watch {
    pub fn new(subs: &[Subscription]) -> Self {
        Self {
            before: vec![HashSet::new(); subs.len()],
        }
    }

    /// Note which of `keys` each subscription covers now, before the write changes them.
    pub fn before(&mut self, conn: &Connection, subs: &[Subscription], keys: &[Key]) -> Result<()> {
        if subs.is_empty() || keys.is_empty() {
            return Ok(());
        }
        touch(conn, keys)?;
        for (seen, sub) in self.before.iter_mut().zip(subs) {
            seen.extend(matching(conn, &sub.filter)?.into_keys());
        }
        Ok(())
    }

    /// Each subscription's changes after the write, in the order of `keys`: covered now is
    /// upserted; covered before and not now (removed, dropped by retention, or no longer matching)
    /// is removed.
    pub fn after(
        self,
        conn: &Connection,
        subs: &[Subscription],
        keys: &[Key],
    ) -> Result<Vec<Vec<ItemChange>>> {
        if subs.is_empty() || keys.is_empty() {
            return Ok(vec![Vec::new(); subs.len()]);
        }
        touch(conn, keys)?;
        let mut batches = Vec::with_capacity(subs.len());
        for (before, sub) in self.before.into_iter().zip(subs) {
            let now = matching(conn, &sub.filter)?;
            let mut batch = Vec::new();
            for key in keys {
                if let Some(json) = now.get(key) {
                    batch.push(ItemChange::ItemUpserted(ItemUpserted {
                        change: ItemUpsertedChange::Upserted,
                        item: item(json)?,
                    }));
                } else if before.contains(key) {
                    batch.push(ItemChange::ItemRemoved(ItemRemoved {
                        change: ItemRemovedChange::Removed,
                        source: key.source(),
                        id: key.id.clone(),
                    }));
                }
            }
            batches.push(batch);
        }
        Ok(batches)
    }
}

/// Send each non-empty batch; a subscription whose receiver is gone ends here.
pub(crate) fn deliver(subs: &mut Vec<Subscription>, batches: Vec<Vec<ItemChange>>) {
    let mut batches = batches.into_iter();
    subs.retain(|sub| match batches.next() {
        Some(batch) if !batch.is_empty() => sub.sender.send(batch).is_ok(),
        _ => true,
    });
}

/// Put `keys` in the connection's `temp.touched`.
fn touch(conn: &Connection, keys: &[Key]) -> Result<()> {
    conn.execute("DELETE FROM temp.touched", [])?;
    let mut insert = conn.prepare("INSERT OR IGNORE INTO temp.touched VALUES (?1, ?2, ?3)")?;
    for key in keys {
        insert.execute(params![key.connector, key.instance, key.id])?;
    }
    Ok(())
}

/// The touched rows a filter covers, with their JSON.
fn matching(conn: &Connection, filter: &Sql) -> Result<HashMap<Key, String>> {
    let mut sql = Sql::new(
        "SELECT i.connector, i.instance, i.id, i.json FROM items i JOIN temp.touched t \
         ON t.connector = i.connector AND t.instance = i.instance AND t.id = i.id",
    );
    sql.append(filter);
    let mut statement = conn.prepare(&sql.text)?;
    let rows = statement.query_map(rusqlite::params_from_iter(&sql.params), |row| {
        let key = Key {
            connector: row.get(0)?,
            instance: row.get(1)?,
            id: row.get(2)?,
        };
        Ok((key, row.get::<_, String>(3)?))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
