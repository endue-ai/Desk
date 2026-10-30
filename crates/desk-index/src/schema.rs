//! The tables, their version in `PRAGMA user_version`, the forward migrations and the full-text
//! table's rebuild.

use rusqlite::{Connection, Transaction};

use crate::error::{Error, ErrorCode, Result};

/// The schema version this build writes.
pub const SCHEMA_VERSION: u32 = 1;

/// Schema version 1. `seq` is the rowid the full-text table points at: an explicit
/// `INTEGER PRIMARY KEY` keeps it across `VACUUM`. An item's key is `(connector, instance, id)`.
const ITEMS_V1: &str = "
CREATE TABLE items (
  seq INTEGER PRIMARY KEY,
  connector TEXT NOT NULL,
  instance TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_at TEXT,
  deep_link TEXT,
  body TEXT,
  json TEXT NOT NULL,
  status TEXT,
  unread INTEGER,
  updated_at_utc INTEGER NOT NULL,
  created_at_utc INTEGER,
  start_utc INTEGER,
  end_utc INTEGER,
  due_utc INTEGER,
  received_at_utc INTEGER,
  published_at_utc INTEGER,
  UNIQUE (connector, instance, id)
);
CREATE INDEX items_kind_updated ON items (kind, updated_at_utc);
CREATE INDEX items_source_updated ON items (connector, instance, updated_at_utc);
";

/// The external-content FTS5 table over title and body, kept by triggers.
const FTS: &str = "
CREATE VIRTUAL TABLE items_fts USING fts5 (
  title, body, content = 'items', content_rowid = 'seq', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
END;
CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, title, body)
    VALUES ('delete', old.seq, old.title, old.body);
  INSERT INTO items_fts (rowid, title, body) VALUES (new.seq, new.title, new.body);
END;
";

const DROP_FTS: &str = "
DROP TRIGGER IF EXISTS items_fts_insert;
DROP TRIGGER IF EXISTS items_fts_delete;
DROP TRIGGER IF EXISTS items_fts_update;
DROP TABLE IF EXISTS items_fts;
";

/// The keys one write touched, for the subscriptions' queries. Per connection, never on disk.
const TOUCHED: &str = "
CREATE TEMP TABLE IF NOT EXISTS touched (
  connector TEXT NOT NULL, instance TEXT NOT NULL, id TEXT NOT NULL,
  PRIMARY KEY (connector, instance, id)
) WITHOUT ROWID;
";

/// Step `n` takes a file from version `n` to `n + 1`. Steps are never edited once released.
const MIGRATIONS: [fn(&Transaction<'_>) -> rusqlite::Result<()>; SCHEMA_VERSION as usize] = [v1];

fn v1(tx: &Transaction<'_>) -> rusqlite::Result<()> {
    tx.execute_batch(ITEMS_V1)?;
    tx.execute_batch(FTS)
}

/// Bring the file to `SCHEMA_VERSION`, one transaction per step. A file a newer desk wrote is
/// `unsupported` and left as it is.
pub(crate) fn migrate(conn: &mut Connection) -> Result<()> {
    let found: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if found > SCHEMA_VERSION {
        return Err(Error::new(
            ErrorCode::Unsupported,
            format!(
                "the item index is at schema version {found}; this desk reads up to \
                 {SCHEMA_VERSION}"
            ),
        ));
    }
    for version in found..SCHEMA_VERSION {
        let tx = conn.transaction()?;
        MIGRATIONS[version as usize](&tx)?;
        tx.pragma_update(None, "user_version", version + 1)?;
        tx.commit()?;
    }
    conn.execute_batch(TOUCHED)?;
    Ok(())
}

/// Drop and recreate the full-text table and its triggers, refill it from `items` and rebuild every
/// index of `items`. The items themselves are kept.
pub(crate) fn rebuild(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute_batch(DROP_FTS)?;
    tx.execute_batch(FTS)?;
    tx.execute("INSERT INTO items_fts (items_fts) VALUES ('rebuild')", [])?;
    tx.execute_batch("REINDEX items;")?;
    tx.commit()?;
    Ok(())
}
