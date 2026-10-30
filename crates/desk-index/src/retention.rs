//! Limits per source (connector and instance): a cap on items, the oldest `updatedAt` going first,
//! and a retention period; both enforced after each upsert. Counts per source.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::ItemSource;
use rusqlite::{Connection, params};

use crate::columns::Key;
use crate::error::Result;

/// How much of one source the index keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// The most items kept; past it the oldest `updatedAt` go first (ties: the smallest id).
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

/// A source as `(connector, instance)`.
pub(crate) type SourceKey = (String, String);

/// The keys the limits drop from `sources`: first what is past `keep_days`, then the oldest of the
/// rest past `max_items`.
pub(crate) fn overflow(
    conn: &Connection,
    limits: &HashMap<SourceKey, Limits>,
    sources: &[SourceKey],
) -> Result<Vec<Key>> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_secs() as i64);
    let mut dropped = Vec::new();
    for source in sources {
        let (connector, instance) = source;
        let limits = limits.get(source).copied().unwrap_or_default();
        let cutoff = limits
            .keep_days
            .map_or(i64::MIN, |days| now - i64::from(days) * 86_400);
        let mut expired = conn.prepare(
            "SELECT id FROM items WHERE connector = ?1 AND instance = ?2 AND updated_at_utc < ?3 \
             ORDER BY updated_at_utc, id",
        )?;
        for id in expired.query_map(params![connector, instance, cutoff], |row| row.get(0))? {
            dropped.push(key(source, id?));
        }
        let kept: i64 = conn.query_row(
            "SELECT COUNT(*) FROM items \
             WHERE connector = ?1 AND instance = ?2 AND updated_at_utc >= ?3",
            params![connector, instance, cutoff],
            |row| row.get(0),
        )?;
        let over = kept.saturating_sub(i64::try_from(limits.max_items).unwrap_or(i64::MAX));
        if over > 0 {
            let mut oldest = conn.prepare(
                "SELECT id FROM items \
                 WHERE connector = ?1 AND instance = ?2 AND updated_at_utc >= ?3 \
                 ORDER BY updated_at_utc, id LIMIT ?4",
            )?;
            for id in
                oldest.query_map(params![connector, instance, cutoff, over], |row| row.get(0))?
            {
                dropped.push(key(source, id?));
            }
        }
    }
    Ok(dropped)
}

fn key((connector, instance): &SourceKey, id: String) -> Key {
    Key {
        connector: connector.clone(),
        instance: instance.clone(),
        id,
    }
}

/// `(source, items)` for every source with items, by connector and instance.
pub(crate) fn counts(conn: &Connection) -> Result<Vec<(ItemSource, u64)>> {
    let mut statement = conn.prepare(
        "SELECT connector, instance, COUNT(*) FROM items GROUP BY connector, instance \
         ORDER BY connector, instance",
    )?;
    let rows = statement.query_map([], |row| {
        let source = ItemSource {
            connector: row.get(0)?,
            instance: row.get(1)?,
        };
        Ok((source, row.get::<_, i64>(2)? as u64))
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}
