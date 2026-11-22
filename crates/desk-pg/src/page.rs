//! What a statement answers, a page at a time: its columns as RowDescription describes them, rows
//! of the server's text, and with its last page the command tag, the row count and the transaction
//! state; or the bytes of a COPY out; and the notices the call heard. The limits say how much one
//! page holds.

use fallible_iterator::FallibleIterator;
use postgres_protocol::message::backend::{DataRowBody, RowDescriptionBody};

use crate::error::{Error, ServerError, protocol};

/// One column, as RowDescription describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Column {
    pub name: String,
    pub type_oid: u32,
    pub type_modifier: i32,
    pub type_size: i16,
    /// The table it comes from and its attribute number there; 0 and 0 for an expression.
    pub table_oid: u32,
    pub column_number: i16,
}

pub(crate) fn columns(body: &RowDescriptionBody) -> Result<Vec<Column>, Error> {
    let mut out = Vec::new();
    let mut fields = body.fields();
    while let Some(f) = fields.next().map_err(protocol)? {
        out.push(Column {
            name: f.name().to_owned(),
            type_oid: f.type_oid(),
            type_modifier: f.type_modifier(),
            type_size: f.type_size(),
            table_oid: f.table_oid(),
            column_number: f.column_id(),
        });
    }
    Ok(out)
}

/// A row's values in the server's text form; `None` is NULL.
pub type Row = Vec<Option<String>>;

/// A row and the bytes of its values, as they came.
pub(crate) fn row(body: &DataRowBody) -> Result<(Row, usize), Error> {
    let buffer = body.buffer();
    let mut out = Vec::new();
    let mut bytes = 0;
    let mut ranges = body.ranges();
    while let Some(range) = ranges.next().map_err(protocol)? {
        out.push(range.map(|r| {
            bytes += r.len();
            String::from_utf8_lossy(&buffer[r]).into_owned()
        }));
    }
    Ok((out, bytes))
}

/// The transaction state ReadyForQuery reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Transaction {
    #[default]
    Idle,
    Open,
    Failed,
}

impl Transaction {
    pub(crate) fn of(status: u8) -> Transaction {
        match status {
            b'T' => Transaction::Open,
            b'E' => Transaction::Failed,
            _ => Transaction::Idle,
        }
    }
}

/// Which way a COPY goes, its format (text for text and CSV) and how many columns it has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Copy {
    pub direction: Direction,
    pub binary: bool,
    pub columns: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    In,
    Out,
}

/// One page of a statement's answer.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Page {
    /// With a statement's first page, when it returns rows.
    pub columns: Option<Vec<Column>>,
    pub rows: Vec<Row>,
    /// Whether the statement has more to read (`fetch`), or a COPY FROM STDIN waits for data.
    pub more: bool,
    /// With the last page: the command tag, the rows over all pages or the tag's count, and the
    /// transaction state.
    pub tag: Option<String>,
    pub row_count: Option<u64>,
    pub transaction: Option<Transaction>,
    /// The server's error; the statement ended with it.
    pub error: Option<ServerError>,
    /// With a COPY's first page.
    pub copy: Option<Copy>,
    /// A COPY out's bytes.
    pub data: Option<Vec<u8>>,
    /// The notices the server sent while this call ran, in order (ADR 0334); at most
    /// `MAX_NOTICES`, and `notices_skipped` counts the rest.
    pub notices: Vec<ServerError>,
    pub notices_skipped: u64,
}

/// The notices one page keeps.
pub const MAX_NOTICES: usize = 10_000;

/// How much one page holds: rows, or bytes of values, whichever comes first; always one row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub rows: usize,
    pub bytes: usize,
}

pub const PAGE_ROWS: usize = 1_000;
pub const MAX_PAGE_ROWS: usize = 10_000;
pub const PAGE_BYTES: usize = 4 * 1024 * 1024;
pub const MIN_PAGE_BYTES: usize = 64 * 1024;
pub const MAX_PAGE_BYTES: usize = 16 * 1024 * 1024;

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            rows: PAGE_ROWS,
            bytes: PAGE_BYTES,
        }
    }
}

impl Limits {
    /// The limits asked for, the defaults for those not named; out of range is `Error::Invalid`.
    pub fn new(rows: Option<u64>, bytes: Option<u64>) -> Result<Limits, Error> {
        let rows = rows.map_or(Ok(PAGE_ROWS), |r| within(r, 1, MAX_PAGE_ROWS, "pageRows"))?;
        let bytes = bytes.map_or(Ok(PAGE_BYTES), |b| {
            within(b, MIN_PAGE_BYTES, MAX_PAGE_BYTES, "pageBytes")
        })?;
        Ok(Limits { rows, bytes })
    }

    /// Whether a page of `rows` rows and `bytes` bytes is full.
    pub(crate) fn full(&self, rows: usize, bytes: usize) -> bool {
        rows >= self.rows || (rows > 0 && bytes >= self.bytes)
    }
}

fn within(value: u64, low: usize, high: usize, name: &str) -> Result<usize, Error> {
    usize::try_from(value)
        .ok()
        .filter(|v| (low..=high).contains(v))
        .ok_or_else(|| Error::Invalid(format!("{name} is {low} to {high}")))
}

/// The count a command tag ends with (`INSERT 0 5`, `UPDATE 3`, `COPY 10`), if it has one.
pub(crate) fn tag_count(tag: &str) -> Option<u64> {
    let mut words = tag.split(' ');
    let first = words.next()?;
    let last = words.next_back()?;
    let counted = [
        "INSERT", "UPDATE", "DELETE", "SELECT", "MERGE", "MOVE", "FETCH", "COPY",
    ];
    counted
        .contains(&first)
        .then(|| last.parse().ok())
        .flatten()
}

/// `tag` with the count it ends with replaced by `total` (`SELECT 498` read in pages of 1000 rows
/// after 2002 is `SELECT 2500`); a tag without a count stays as it is.
pub(crate) fn counted_tag(tag: &str, total: u64) -> String {
    match (tag_count(tag), tag.rsplit_once(' ')) {
        (Some(_), Some((head, _))) => format!("{head} {total}"),
        _ => tag.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tag_s_count() {
        assert_eq!(tag_count("INSERT 0 5"), Some(5));
        assert_eq!(tag_count("UPDATE 3"), Some(3));
        assert_eq!(tag_count("SELECT 2500"), Some(2500));
        assert_eq!(tag_count("COPY 10"), Some(10));
        assert_eq!(tag_count("CREATE TABLE"), None);
        assert_eq!(tag_count("BEGIN"), None);
        assert_eq!(tag_count(""), None);
    }

    #[test]
    fn a_paged_tag_counts_every_page() {
        assert_eq!(counted_tag("SELECT 498", 2500), "SELECT 2500");
        assert_eq!(counted_tag("INSERT 0 3", 3), "INSERT 0 3");
        assert_eq!(counted_tag("SHOW", 1), "SHOW");
    }

    #[test]
    fn limits_hold_their_ranges() {
        assert_eq!(Limits::new(None, None), Ok(Limits::default()));
        assert_eq!(Limits::new(Some(1), Some(65_536)).unwrap().rows, 1);
        assert!(Limits::new(Some(0), None).is_err());
        assert!(Limits::new(Some(10_001), None).is_err());
        assert!(Limits::new(None, Some(65_535)).is_err());
        assert!(Limits::new(None, Some(16 * 1024 * 1024 + 1)).is_err());
    }

    #[test]
    fn a_page_is_full_by_rows_or_bytes_and_holds_one_row() {
        let limits = Limits {
            rows: 3,
            bytes: 100,
        };
        assert!(!limits.full(0, 1_000));
        assert!(limits.full(1, 100));
        assert!(!limits.full(2, 99));
        assert!(limits.full(3, 0));
    }

    #[test]
    fn ready_for_query_states() {
        assert_eq!(Transaction::of(b'I'), Transaction::Idle);
        assert_eq!(Transaction::of(b'T'), Transaction::Open);
        assert_eq!(Transaction::of(b'E'), Transaction::Failed);
    }
}
