//! The search index: `index.sqlite`, an FTS5 table of every entry's words. It is derived from the
//! files and never synced: it remembers the files' fingerprint, and is built again from them when
//! that changes or when the database is missing or cannot be opened.

use std::path::Path;

use rusqlite::{Connection, params};

use crate::MemoryError;

pub const INDEX: &str = "index.sqlite";

pub struct Index {
    db: Connection,
}

/// One row: an entry's id, kind and words.
pub struct Row<'a> {
    pub id: &'a str,
    pub kind: &'a str,
    pub text: String,
}

impl Index {
    /// The index in `dir`, made when missing. A file that is not a database is replaced.
    pub fn open(dir: &Path) -> Result<Self, MemoryError> {
        let path = dir.join(INDEX);
        let db = match Self::connect(&path) {
            Ok(db) => db,
            Err(_) => {
                let _ = std::fs::remove_file(&path);
                Self::connect(&path)?
            }
        };
        Ok(Self { db })
    }

    fn connect(path: &Path) -> Result<Connection, MemoryError> {
        let db = Connection::open(path).map_err(sql)?;
        db.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS entries USING fts5(
                 id UNINDEXED, kind UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2');
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )
        .map_err(sql)?;
        Ok(db)
    }

    /// The fingerprint of the files the index was built from.
    pub fn fingerprint(&self) -> Option<String> {
        self.db
            .query_row(
                "SELECT value FROM meta WHERE key = 'fingerprint'",
                [],
                |row| row.get(0),
            )
            .ok()
    }

    /// Build the index again from `rows`, as of `fingerprint`.
    pub fn rebuild<'a>(
        &mut self,
        rows: impl Iterator<Item = Row<'a>>,
        fingerprint: &str,
    ) -> Result<(), MemoryError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute("DELETE FROM entries", []).map_err(sql)?;
        for row in rows {
            tx.execute(
                "INSERT INTO entries (id, kind, text) VALUES (?1, ?2, ?3)",
                params![row.id, row.kind, row.text],
            )
            .map_err(sql)?;
        }
        set_fingerprint(&tx, fingerprint)?;
        tx.commit().map_err(sql)
    }

    /// Put `row` in place of the entry with its id, if any.
    pub fn put(&mut self, row: &Row<'_>, fingerprint: &str) -> Result<(), MemoryError> {
        let tx = self.db.transaction().map_err(sql)?;
        tx.execute("DELETE FROM entries WHERE id = ?1", [row.id])
            .map_err(sql)?;
        tx.execute(
            "INSERT INTO entries (id, kind, text) VALUES (?1, ?2, ?3)",
            params![row.id, row.kind, row.text],
        )
        .map_err(sql)?;
        set_fingerprint(&tx, fingerprint)?;
        tx.commit().map_err(sql)
    }

    /// Take the entries with `ids` out.
    pub fn remove(&mut self, ids: &[String], fingerprint: &str) -> Result<(), MemoryError> {
        let tx = self.db.transaction().map_err(sql)?;
        for id in ids {
            tx.execute("DELETE FROM entries WHERE id = ?1", [id])
                .map_err(sql)?;
        }
        set_fingerprint(&tx, fingerprint)?;
        tx.commit().map_err(sql)
    }

    /// The ids whose words match any word of `query`, best first, each with the words around the match.
    pub fn search(
        &self,
        query: &str,
        kind: Option<&str>,
        limit: usize,
    ) -> Result<Vec<(String, String)>, MemoryError> {
        let Some(matching) = match_expression(query) else {
            return Ok(Vec::new());
        };
        let mut statement = self
            .db
            .prepare(
                "SELECT id, snippet(entries, 2, '[', ']', '…', 12) FROM entries
                 WHERE entries MATCH ?1 AND (?2 IS NULL OR kind = ?2)
                 ORDER BY bm25(entries) LIMIT ?3",
            )
            .map_err(sql)?;
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let rows = statement
            .query_map(params![matching, kind, limit], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }
}

fn set_fingerprint(tx: &rusqlite::Transaction<'_>, fingerprint: &str) -> Result<(), MemoryError> {
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('fingerprint', ?1)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [fingerprint],
    )
    .map(|_| ())
    .map_err(sql)
}

/// Words, not a search syntax: each word of the query as a quoted prefix, any of them matching.
fn match_expression(query: &str) -> Option<String> {
    let mut words: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    words.sort();
    words.dedup();
    // One letter matches too much as a prefix; keep such words only when nothing longer is asked.
    if words.iter().any(|word| word.chars().count() > 1) {
        words.retain(|word| word.chars().count() > 1);
    }
    if words.is_empty() {
        return None;
    }
    Some(
        words
            .iter()
            .map(|word| format!("\"{word}\"*"))
            .collect::<Vec<_>>()
            .join(" OR "),
    )
}

fn sql(error: rusqlite::Error) -> MemoryError {
    MemoryError::Io(format!("memory index: {error}"))
}
