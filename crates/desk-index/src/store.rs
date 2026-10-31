//! The writes: upsert, remove and clear. Each is one transaction that also applies the limits and
//! ends by handing every subscription one batch of what it changed.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;

use desk_bridge::{Item, ItemSource};
use rusqlite::{Connection, params};

use crate::columns::{Key, row};
use crate::error::Result;
use crate::retention::{self, Limits, SourceKey};
use crate::subscribe::{Subscription, Watch, deliver};

const UPSERT: &str = "
INSERT INTO items (
  connector, instance, id, kind, title, updated_at, created_at, deep_link, body, json, status,
  unread, updated_at_utc, created_at_utc, start_utc, end_utc, due_utc, received_at_utc,
  published_at_utc
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
ON CONFLICT (connector, instance, id) DO UPDATE SET
  kind = excluded.kind, title = excluded.title, updated_at = excluded.updated_at,
  created_at = excluded.created_at, deep_link = excluded.deep_link, body = excluded.body,
  json = excluded.json, status = excluded.status, unread = excluded.unread,
  updated_at_utc = excluded.updated_at_utc, created_at_utc = excluded.created_at_utc,
  start_utc = excluded.start_utc, end_utc = excluded.end_utc, due_utc = excluded.due_utc,
  received_at_utc = excluded.received_at_utc, published_at_utc = excluded.published_at_utc
";

/// The connection and what lives beside it in memory.
pub(crate) struct State {
    pub conn: Connection,
    pub subs: Vec<Subscription>,
    pub limits: HashMap<SourceKey, Limits>,
}

impl State {
    /// Insert or replace `items` (the last of one key wins), then drop what the limits of their
    /// sources no longer keep.
    pub fn upsert(&mut self, items: &[Item]) -> Result<()> {
        let rows = items.iter().map(row).collect::<Result<Vec<_>>>()?;
        let keys = unique(rows.iter().map(|row| row.key.clone()));
        if keys.is_empty() {
            return Ok(());
        }
        let sources = unique(
            keys.iter()
                .map(|k| (k.connector.clone(), k.instance.clone())),
        );
        let tx = self.conn.transaction()?;
        let mut watch = Watch::new(&self.subs);
        watch.before(&tx, &self.subs, &keys)?;
        {
            let mut insert = tx.prepare(UPSERT)?;
            for r in &rows {
                let [updated, created, start, end, due, received, published] = r.utc;
                insert.execute(params![
                    r.key.connector,
                    r.key.instance,
                    r.key.id,
                    r.kind,
                    r.title,
                    r.updated_at,
                    r.created_at,
                    r.deep_link,
                    r.body,
                    r.json,
                    r.status,
                    r.unread,
                    updated,
                    created,
                    start,
                    end,
                    due,
                    received,
                    published,
                ])?;
            }
        }
        let dropped = retention::overflow(&tx, &self.limits, &sources)?;
        let written: HashSet<&Key> = keys.iter().collect();
        let untouched: Vec<Key> = dropped
            .iter()
            .filter(|k| !written.contains(k))
            .cloned()
            .collect();
        watch.before(&tx, &self.subs, &untouched)?;
        delete(&tx, &dropped)?;
        let changed = unique(keys.iter().cloned().chain(dropped));
        let batches = watch.after(&tx, &self.subs, &changed)?;
        tx.commit()?;
        deliver(&mut self.subs, batches);
        Ok(())
    }

    /// Remove the items with these keys; answers how many there were.
    pub fn remove(&mut self, keys: Vec<Key>) -> Result<usize> {
        let keys = unique(keys);
        if keys.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.transaction()?;
        let mut watch = Watch::new(&self.subs);
        watch.before(&tx, &self.subs, &keys)?;
        let removed = delete(&tx, &keys)?;
        let batches = watch.after(&tx, &self.subs, &keys)?;
        tx.commit()?;
        deliver(&mut self.subs, batches);
        Ok(removed)
    }

    /// Remove every item of one source.
    pub fn clear(&mut self, source: &ItemSource) -> Result<usize> {
        let ids: Vec<String> = {
            let mut statement = self.conn.prepare(
                "SELECT id FROM items WHERE connector = ?1 AND instance = ?2 ORDER BY id",
            )?;
            let rows = statement
                .query_map(params![source.connector, source.instance], |row| row.get(0))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        self.remove(ids.iter().map(|id| Key::new(source, id)).collect())
    }
}

fn delete(conn: &Connection, keys: &[Key]) -> Result<usize> {
    let mut statement =
        conn.prepare("DELETE FROM items WHERE connector = ?1 AND instance = ?2 AND id = ?3")?;
    let mut removed = 0;
    for key in keys {
        removed += statement.execute(params![key.connector, key.instance, key.id])?;
    }
    Ok(removed)
}

/// The values in their first order, each once.
fn unique<T: Clone + Eq + Hash>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}
