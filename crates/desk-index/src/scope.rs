//! The caller's `data:read` scope, and the connector id matcher it uses inside SQL.

use desk_bridge::{ConnectorPattern, DataReadPermission, ItemKind};
use rusqlite::Connection;
use rusqlite::functions::FunctionFlags;

use crate::sql::Sql;

/// The SQL function `desk_star_match(pattern, connector)`: `star_match` inside a query.
const MATCH_FN: &str = "desk_star_match";

/// What a caller may read: the kinds and connector id patterns of its `data:read` scope. `None`
/// means all of them; an empty list covers nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DataReadScope {
    pub kinds: Option<Vec<ItemKind>>,
    pub sources: Option<Vec<ConnectorPattern>>,
}

impl DataReadScope {
    /// Every kind from every connector: the core's own reads.
    pub fn all() -> Self {
        Self::default()
    }

    /// ` AND ...` narrowing `items i` to the rows the scope covers.
    pub(crate) fn push_filter(&self, sql: &mut Sql) {
        if let Some(kinds) = &self.kinds {
            sql.push(" AND ");
            push_kinds(sql, kinds);
        }
        if let Some(patterns) = &self.sources {
            sql.push(" AND ").any(patterns, |sql, pattern| {
                if pattern == "*" {
                    sql.push("1");
                } else if pattern.contains('*') {
                    sql.push(MATCH_FN)
                        .push("(")
                        .bind(pattern.clone())
                        .push(", i.connector)");
                } else {
                    sql.push("i.connector = ").bind(pattern.clone());
                }
            });
        }
    }
}

impl From<&DataReadPermission> for DataReadScope {
    fn from(perm: &DataReadPermission) -> Self {
        Self {
            kinds: perm.kinds.clone(),
            sources: perm.sources.clone(),
        }
    }
}

impl From<DataReadPermission> for DataReadScope {
    fn from(perm: DataReadPermission) -> Self {
        Self {
            kinds: perm.kinds,
            sources: perm.sources,
        }
    }
}

/// `i.kind IN (...)`, or `0` for no kinds.
pub(crate) fn push_kinds(sql: &mut Sql, kinds: &[ItemKind]) {
    sql.any(kinds, |sql, kind| {
        sql.push("i.kind = ").bind(kind_name(*kind));
    });
}

/// The kind as the item spec writes it (`event`, `task`).
pub(crate) fn kind_name(kind: ItemKind) -> String {
    match serde_json::to_value(kind) {
        Ok(serde_json::Value::String(name)) => name,
        _ => String::new(),
    }
}

/// `*` in `pattern` matches any run of characters, dots included; everything else is literal, as
/// in `cmd:invoke` ids. `desk.*` covers `desk.fixtures`, not `example.desk`.
pub(crate) fn star_match(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if parts.len() == 1 {
        return pattern == text;
    }
    if !text.starts_with(first) || text.len() < first.len() + last.len() || !text.ends_with(last) {
        return false;
    }
    let mut rest = &text[first.len()..text.len() - last.len()];
    for part in &parts[1..parts.len() - 1] {
        match rest.find(part) {
            Some(at) => rest = &rest[at + part.len()..],
            None => return false,
        }
    }
    true
}

/// Make `desk_star_match` callable from this connection's SQL.
pub(crate) fn register(conn: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC;
    conn.create_scalar_function(MATCH_FN, 2, flags, |ctx| {
        let pattern = ctx.get_raw(0).as_str().unwrap_or_default();
        let connector = ctx.get_raw(1).as_str().unwrap_or_default();
        Ok(star_match(pattern, connector))
    })
}

#[cfg(test)]
mod tests {
    use super::star_match;

    #[test]
    fn stars_match_runs_of_characters_dots_included() {
        assert!(star_match("*", "desk.fixtures"));
        assert!(star_match("desk.*", "desk.fixtures"));
        assert!(star_match("desk.*", "desk.mail.work"));
        assert!(star_match("*.mail", "desk.mail"));
        assert!(star_match("desk.*.work", "desk.mail.work"));
        assert!(star_match("desk.fixtures", "desk.fixtures"));
        assert!(!star_match("desk.*", "example.desk"));
        assert!(!star_match("desk.*", "desk"));
        assert!(!star_match("desk.fixtures", "desk.fixtures2"));
        assert!(!star_match("desk.*.work", "desk.work"));
    }
}
