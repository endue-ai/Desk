//! `ItemQuery` to SQL: the filters, the caller's scope, a stable order (ties broken by id, then
//! connector and instance) and keyset paging after the cursor.

use desk_bridge::{ItemPage, ItemQuery, ItemSort, SortDirection};
use rusqlite::Connection;
use rusqlite::types::Value as Sql3;

use crate::columns::item;
use crate::error::{Error, Result};
use crate::fields::resolve;
use crate::scope::DataReadScope;
use crate::sql::Sql;
use crate::{cursor, filter};

/// Items per page when `limit` is absent, and the most a page holds.
pub const DEFAULT_LIMIT: u64 = 50;
pub const MAX_LIMIT: u64 = 500;

/// One key of the order.
struct SortKey {
    expr: String,
    desc: bool,
    nullable: bool,
}

/// `WHERE` over `items i`: the query's filters and the scope, so `limit`, `cursor` and the count
/// only ever see rows the caller may read.
pub(crate) fn filter(query: &ItemQuery, scope: &DataReadScope) -> Result<Sql> {
    let mut sql = Sql::new(" WHERE 1");
    filter::push(&mut sql, query)?;
    scope.push_filter(&mut sql);
    Ok(sql)
}

/// One page of `query`.
pub(crate) fn page(
    conn: &Connection,
    query: &ItemQuery,
    scope: &DataReadScope,
) -> Result<ItemPage> {
    let limit = limit(query)?;
    let keys = sort_keys(query.sort.as_deref())?;
    let mut sql = Sql::new("SELECT i.json");
    for key in &keys {
        sql.push(", ").push(&key.expr);
    }
    sql.push(" FROM items i").append(&filter(query, scope)?);
    if let Some(text) = &query.cursor {
        push_after(&mut sql, &keys, &cursor::decode(text, keys.len())?);
    }
    sql.push(" ORDER BY ");
    for (n, key) in keys.iter().enumerate() {
        if n > 0 {
            sql.push(", ");
        }
        if key.nullable {
            sql.push("(").push(&key.expr).push(" IS NULL), ");
        }
        sql.push(&key.expr)
            .push(if key.desc { " DESC" } else { " ASC" });
    }
    sql.push(" LIMIT ").bind(limit as i64 + 1);

    let mut statement = conn.prepare(&sql.text)?;
    let mut rows = statement.query(rusqlite::params_from_iter(&sql.params))?;
    let (mut items, mut last) = (Vec::new(), Vec::new());
    let mut more = false;
    while let Some(row) = rows.next()? {
        if items.len() as u64 == limit {
            more = true;
            break;
        }
        items.push(item(&row.get::<_, String>(0)?)?);
        last = (1..=keys.len())
            .map(|n| row.get::<_, Sql3>(n))
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(ItemPage {
        items,
        cursor: more.then(|| cursor::encode(&last)),
    })
}

/// How many rows the query and the scope cover, whatever the cursor and limit.
pub(crate) fn count(conn: &Connection, query: &ItemQuery, scope: &DataReadScope) -> Result<u64> {
    limit(query)?;
    sort_keys(query.sort.as_deref())?;
    let mut sql = Sql::new("SELECT COUNT(*) FROM items i");
    sql.append(&filter(query, scope)?);
    let n: i64 = conn.query_row(&sql.text, rusqlite::params_from_iter(&sql.params), |row| {
        row.get(0)
    })?;
    Ok(n as u64)
}

fn limit(query: &ItemQuery) -> Result<u64> {
    match query.limit {
        None => Ok(DEFAULT_LIMIT),
        Some(limit) if (1..=MAX_LIMIT).contains(&limit) => Ok(limit),
        Some(limit) => Err(Error::invalid(format!(
            "limit is 1 to {MAX_LIMIT}, not {limit}"
        ))),
    }
}

/// The query's sort (updatedAt, newest first, when absent), then id, connector and instance.
fn sort_keys(sort: Option<&[ItemSort]>) -> Result<Vec<SortKey>> {
    let newest = [ItemSort {
        field: "updatedAt".into(),
        dir: SortDirection::Desc,
    }];
    let mut keys = Vec::new();
    for entry in sort.unwrap_or(&newest) {
        let field = resolve(&entry.field)?;
        keys.push(SortKey {
            expr: field.expr(),
            desc: entry.dir == SortDirection::Desc,
            nullable: field.nullable(),
        });
    }
    for expr in ["i.id", "i.connector", "i.instance"] {
        keys.push(SortKey {
            expr: expr.into(),
            desc: false,
            nullable: false,
        });
    }
    Ok(keys)
}

/// ` AND` the rows after `values` in the order of `keys`. A nullable key sorts as two (`IS NULL`
/// first, so missing values come last either way, then the value); each step is
/// `(a0 IS v0 AND ... AND ak > vk)`, with `<` for descending keys.
fn push_after(sql: &mut Sql, keys: &[SortKey], values: &[Sql3]) {
    let mut atoms: Vec<(String, bool, Sql3)> = Vec::new();
    for (key, value) in keys.iter().zip(values) {
        if key.nullable {
            let missing = Sql3::Integer(i64::from(*value == Sql3::Null));
            atoms.push((format!("({} IS NULL)", key.expr), false, missing));
        }
        atoms.push((key.expr.clone(), key.desc, value.clone()));
    }
    sql.push(" AND ")
        .any(&(0..atoms.len()).collect::<Vec<_>>(), |sql, last| {
            sql.push("(");
            for (expr, _, value) in &atoms[..*last] {
                sql.push(expr)
                    .push(" IS ")
                    .bind(value.clone())
                    .push(" AND ");
            }
            let (expr, desc, value) = &atoms[*last];
            sql.push(expr)
                .push(if *desc { " < " } else { " > " })
                .bind(value.clone())
                .push(")");
        });
}
