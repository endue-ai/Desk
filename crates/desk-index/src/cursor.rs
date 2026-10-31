//! The page cursor: the last item's sort key values and its key (id, connector, instance), as a
//! JSON array in URL-safe base64. Opaque to callers; one this index cannot read is
//! `invalid_params`.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rusqlite::types::Value as Sql3;
use serde_json::Value;

use crate::error::{Error, Result};

pub(crate) fn encode(values: &[Sql3]) -> String {
    let json: Vec<Value> = values
        .iter()
        .map(|value| match value {
            Sql3::Null => Value::Null,
            Sql3::Integer(n) => Value::from(*n),
            Sql3::Real(f) => Value::from(*f),
            Sql3::Text(s) => Value::from(s.as_str()),
            Sql3::Blob(b) => Value::from(String::from_utf8_lossy(b).into_owned()),
        })
        .collect();
    URL_SAFE_NO_PAD.encode(Value::Array(json).to_string())
}

/// The `len` values `encode` wrote.
pub(crate) fn decode(cursor: &str, len: usize) -> Result<Vec<Sql3>> {
    let unreadable = || Error::invalid("the cursor is not one this index gave for this query");
    let bytes = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| unreadable())?;
    let Ok(Value::Array(values)) = serde_json::from_slice::<Value>(&bytes) else {
        return Err(unreadable());
    };
    if values.len() != len {
        return Err(unreadable());
    }
    values
        .into_iter()
        .map(|value| match value {
            Value::Null => Ok(Sql3::Null),
            Value::String(s) => Ok(Sql3::Text(s)),
            Value::Number(n) => match n.as_i64() {
                Some(i) if !n.is_f64() => Ok(Sql3::Integer(i)),
                _ => n.as_f64().map(Sql3::Real).ok_or_else(unreadable),
            },
            _ => Err(unreadable()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Sql3, decode, encode};

    #[test]
    fn a_cursor_reads_back_its_values_and_types() {
        let values = vec![
            Sql3::Integer(1_793_318_400),
            Sql3::Real(2.0),
            Sql3::Null,
            Sql3::Text("t/1".into()),
        ];
        assert_eq!(decode(&encode(&values), 4).unwrap(), values);
        assert!(decode(&encode(&values), 3).is_err());
        assert!(decode("not a cursor", 4).is_err());
    }
}
