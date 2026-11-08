//! `where` and `sort` fields: a dotted path into the item, read from a column for the common ones
//! and from the item's JSON for the rest.

use crate::columns::TIME_FIELDS;
use crate::error::{Error, Result};

/// Where a field's value is read.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Field {
    /// A column holding the field, NULL when the item has none: `i.kind`, `i.status`.
    Column(String),
    /// A time field: its epoch-seconds column, and the JSON path of the string as written.
    Time { column: String, path: String },
    /// Any other field, through `json_extract(i.json, path)`.
    Json(String),
}

impl Field {
    /// The SQL expression of the field's value, for comparing and sorting.
    pub fn expr(&self) -> String {
        match self {
            Field::Column(column) | Field::Time { column, .. } => column.clone(),
            Field::Json(path) => format!("json_extract(i.json, '{path}')"),
        }
    }

    /// Whether the expression can be NULL (the field is optional, or not in every kind).
    pub fn nullable(&self) -> bool {
        !matches!(
            self.expr().as_str(),
            "i.id" | "i.kind" | "i.title" | "i.connector" | "i.instance" | "i.updated_at_utc"
        )
    }
}

/// The field a `FieldPath` names. A path the item spec's pattern refuses is `invalid_params`.
pub(crate) fn resolve(path: &str) -> Result<Field> {
    validate(path)?;
    let column = match path {
        "id" => "i.id",
        "kind" => "i.kind",
        "title" => "i.title",
        "body" => "i.body",
        "deepLink" => "i.deep_link",
        "status" => "i.status",
        "unread" => "i.unread",
        "source.connector" => "i.connector",
        "source.instance" => "i.instance",
        _ => {
            return Ok(match TIME_FIELDS.iter().find(|(field, _)| *field == path) {
                Some((_, column)) => Field::Time {
                    column: format!("i.{column}"),
                    path: json_path(path),
                },
                None => Field::Json(json_path(path)),
            });
        }
    };
    Ok(Field::Column(column.to_string()))
}

/// `^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)*$`, at most 256 characters.
fn validate(path: &str) -> Result<()> {
    let mut segments = path.split('.');
    let first = segments.next().unwrap_or_default();
    let word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    let valid = path.len() <= 256
        && first
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && first.chars().all(word)
        && segments.all(|s| !s.is_empty() && s.chars().all(|c| word(c) || c == '-'));
    if valid {
        Ok(())
    } else {
        Err(Error::invalid(format!(
            "{path:?} is not a field path (start, from.email, raw.labels)"
        )))
    }
}

/// The SQLite JSON path of a validated dotted path: `raw.labels` is `$."raw"."labels"`, a numeric
/// segment is an array index (`points.0.v` is `$."points"[0]."v"`). Safe to put in a SQL literal.
fn json_path(path: &str) -> String {
    let mut out = String::from("$");
    for segment in path.split('.') {
        if segment.chars().all(|c| c.is_ascii_digit()) {
            out.push_str(&format!("[{segment}]"));
        } else {
            out.push_str(&format!(".\"{segment}\""));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{Field, resolve};

    #[test]
    fn common_fields_are_columns_times_are_epochs_and_the_rest_is_json() {
        assert_eq!(resolve("status").unwrap(), Field::Column("i.status".into()));
        assert_eq!(resolve("source.connector").unwrap().expr(), "i.connector");
        assert_eq!(resolve("start").unwrap().expr(), "i.start_utc");
        assert_eq!(
            resolve("raw.labels").unwrap(),
            Field::Json("$.\"raw\".\"labels\"".into())
        );
        assert_eq!(
            resolve("points.0.v").unwrap(),
            Field::Json("$.\"points\"[0].\"v\"".into())
        );
        assert!(!resolve("updatedAt").unwrap().nullable());
        assert!(resolve("due").unwrap().nullable());
        for bad in [
            "",
            "0start",
            "raw.",
            "a..b",
            "raw.'x",
            "a b",
            &"x".repeat(257),
        ] {
            assert!(resolve(bad).is_err(), "{bad}");
        }
    }
}
