//! The narrowing parts of an `ItemQuery` (kinds, sources, text, where) as ` AND ...` clauses over
//! `items i`. Values are always bound; field paths are validated before they reach the SQL.

use desk_bridge::{ConditionOp, ItemCondition, ItemQuery};
use rusqlite::types::Value as Sql3;
use serde_json::Value;

use crate::columns::canonical;
use crate::error::{Error, Result};
use crate::fields::{Field, resolve};
use crate::scope::push_kinds;
use crate::sql::Sql;
use crate::time::epoch_seconds;

/// Append the query's kinds, sources, text and where conditions.
pub(crate) fn push(sql: &mut Sql, query: &ItemQuery) -> Result<()> {
    if let Some(kinds) = &query.kinds {
        if kinds.is_empty() {
            return Err(Error::invalid(
                "kinds lists at least one kind; leave it out for all",
            ));
        }
        sql.push(" AND ");
        push_kinds(sql, kinds);
    }
    if let Some(sources) = &query.sources {
        if sources.is_empty() {
            return Err(Error::invalid(
                "sources lists at least one source; leave it out for all",
            ));
        }
        let mut selectors = Vec::new();
        for selector in sources {
            if selector.starts_with('$') {
                return Err(Error::invalid(format!(
                    "{selector}: a view binds its $name sources before it asks the index"
                )));
            }
            let (connector, instance) = match selector.split_once('/') {
                Some((connector, instance)) => (connector, Some(instance)),
                None => (selector.as_str(), None),
            };
            if connector.is_empty() || instance.is_some_and(str::is_empty) {
                return Err(Error::invalid(format!(
                    "{selector:?} is not a connector or connector/instance"
                )));
            }
            selectors.push((connector.to_string(), instance.map(str::to_string)));
        }
        sql.push(" AND ")
            .any(&selectors, |sql, (connector, instance)| {
                sql.push("(i.connector = ").bind(connector.clone());
                if let Some(instance) = instance {
                    sql.push(" AND i.instance = ").bind(instance.clone());
                }
                sql.push(")");
            });
    }
    if let Some(text) = &query.text {
        push_text(sql, text)?;
    }
    for condition in query.r#where.iter().flatten() {
        sql.push(" AND ");
        push_condition(sql, condition)?;
    }
    Ok(())
}

/// Every word of `text` as a prefix in the full-text table, all of them required. Quoting each word
/// keeps FTS5's query syntax out of the person's text.
fn push_text(sql: &mut Sql, text: &str) -> Result<()> {
    let length = text.chars().count();
    if !(1..=500).contains(&length) {
        return Err(Error::invalid("text is 1 to 500 characters"));
    }
    let words: Vec<String> = text
        .split_whitespace()
        .filter(|word| word.chars().any(char::is_alphanumeric))
        .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
        .collect();
    if words.is_empty() {
        sql.push(" AND 0");
    } else {
        sql.push(" AND i.seq IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ")
            .bind(words.join(" "))
            .push(")");
    }
    Ok(())
}

fn push_condition(sql: &mut Sql, condition: &ItemCondition) -> Result<()> {
    let field = resolve(&condition.field)?;
    let name = &condition.field;
    if condition.op == ConditionOp::Exists {
        let wanted = match &condition.value {
            None => true,
            Some(Value::Bool(wanted)) => *wanted,
            Some(_) => {
                return Err(Error::invalid(format!(
                    "{name}: exists takes true, false or no value"
                )));
            }
        };
        let present = match &field {
            Field::Column(column) | Field::Time { column, .. } => format!("{column} IS NOT NULL"),
            Field::Json(path) => format!("json_type(i.json, '{path}') IS NOT NULL"),
        };
        sql.push(&if wanted {
            present
        } else {
            format!("NOT ({present})")
        });
        return Ok(());
    }
    let value = condition
        .value
        .as_ref()
        .ok_or_else(|| Error::invalid(format!("{name}: the condition needs a value")))?;
    match condition.op {
        ConditionOp::Eq => equal(sql, &field, name, value, true)?,
        ConditionOp::Ne => equal(sql, &field, name, value, false)?,
        ConditionOp::In => {
            let Value::Array(values) = value else {
                return Err(Error::invalid(format!(
                    "{name}: in takes an array of values"
                )));
            };
            let mut parts = Vec::new();
            for value in values {
                let mut part = Sql::default();
                equal(&mut part, &field, name, value, true)?;
                parts.push(part);
            }
            sql.any(&parts, |sql, part| {
                sql.append(part);
            });
        }
        ConditionOp::Contains => contains(sql, &field, value),
        op => {
            let operator = match op {
                ConditionOp::Lt => " < ",
                ConditionOp::Lte => " <= ",
                ConditionOp::Gt => " > ",
                _ => " >= ",
            };
            if matches!(value, Value::Null | Value::Array(_) | Value::Object(_)) {
                return Err(Error::invalid(format!(
                    "{name}: lt, lte, gt and gte compare with a number or a string"
                )));
            }
            let bound = operand(&field, name, value)?;
            sql.push(&field.expr()).push(operator).bind(bound);
        }
    }
    Ok(())
}

/// `eq` (or `ne` when `same` is false). `ne` holds for an item without the field; `null` is a
/// missing field; an object or an array compares as JSON.
fn equal(sql: &mut Sql, field: &Field, name: &str, value: &Value, same: bool) -> Result<()> {
    let expr = field.expr();
    let is = if same { " IS " } else { " IS NOT " };
    match value {
        Value::Null => sql.push(&expr).push(is).push("NULL"),
        Value::Array(_) | Value::Object(_) => sql
            .push(&expr)
            .push(is)
            .push("json(")
            .bind(json_text(value))
            .push(")"),
        _ => sql.push(&expr).push(is).bind(operand(field, name, value)?),
    };
    Ok(())
}

/// A substring of a string field, or an element of an array field.
fn contains(sql: &mut Sql, field: &Field, value: &Value) {
    let path = match field {
        Field::Column(column) => {
            match value {
                Value::String(text) => sql
                    .push("instr(")
                    .push(column)
                    .push(", ")
                    .bind(text.clone())
                    .push(") > 0"),
                _ => sql.push("0"),
            };
            return;
        }
        Field::Time { path, .. } | Field::Json(path) => path,
    };
    sql.push("(CASE json_type(i.json, '")
        .push(path)
        .push("') WHEN 'array' THEN EXISTS (SELECT 1 FROM json_each(i.json, '");
    sql.push(path).push("') e WHERE ");
    match value {
        Value::Null => sql.push("e.type = 'null'"),
        Value::Array(_) | Value::Object(_) => {
            sql.push("e.value = json(").bind(json_text(value)).push(")")
        }
        scalar => sql.push("e.value = ").bind(scalar_of(scalar)),
    };
    sql.push(")");
    if let Value::String(text) = value {
        sql.push(" WHEN 'text' THEN instr(json_extract(i.json, '")
            .push(path)
            .push("'), ")
            .bind(text.clone())
            .push(") > 0");
    }
    sql.push(" ELSE 0 END)");
}

/// The bound value a field compares with: an epoch for a time field, the JSON scalar otherwise.
fn operand(field: &Field, name: &str, value: &Value) -> Result<Sql3> {
    match field {
        Field::Time { .. } => value
            .as_str()
            .and_then(epoch_seconds)
            .map(Sql3::Integer)
            .ok_or_else(|| {
                Error::invalid(format!(
                    "{name} compares with an RFC 3339 time with an offset, not {value}"
                ))
            }),
        _ => Ok(scalar_of(value)),
    }
}

/// An object or an array as the index stores it: keys sorted.
fn json_text(value: &Value) -> String {
    canonical(value.clone()).to_string()
}

/// A JSON scalar as SQLite holds it (`json_extract` reads true as 1).
fn scalar_of(value: &Value) -> Sql3 {
    match value {
        Value::Bool(b) => Sql3::Integer(i64::from(*b)),
        Value::Number(n) => n
            .as_i64()
            .map(Sql3::Integer)
            .unwrap_or_else(|| Sql3::Real(n.as_f64().unwrap_or_default())),
        Value::String(s) => Sql3::Text(s.clone()),
        other => Sql3::Text(other.to_string()),
    }
}
