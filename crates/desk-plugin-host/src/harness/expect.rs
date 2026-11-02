//! What a case expects, checked against what happened: calls and items in order, each matching
//! when it contains what the case wrote.

use serde_json::Value;

use super::Expected;
use super::scripted::Call;

/// How much of one call or item a failure message shows.
const SHOWN: usize = 160;

/// Whether `value` contains `wanted`: every key of an object with a value it contains, arrays of
/// the same length item by item, anything else equal.
pub(super) fn contains(value: &Value, wanted: &Value) -> bool {
    match (value, wanted) {
        (Value::Object(value), Value::Object(wanted)) => wanted
            .iter()
            .all(|(key, wanted)| value.get(key).is_some_and(|value| contains(value, wanted))),
        (Value::Array(value), Value::Array(wanted)) => {
            value.len() == wanted.len() && value.iter().zip(wanted).all(|(v, w)| contains(v, w))
        }
        (value, wanted) => value == wanted,
    }
}

fn shown(value: &Value) -> String {
    let text = value.to_string();
    match text.char_indices().nth(SHOWN) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text,
    }
}

fn call(call: &Call) -> String {
    format!("{} {}", call.method, shown(&call.params))
}

/// The first of `wanted` not found in `made` after the one before it, as (its index, where the
/// search started), or `None` when every one was found in order.
fn first_missing<W, M>(
    wanted: &[W],
    made: &[M],
    matches: impl Fn(&W, &M) -> bool,
) -> Option<(usize, usize)> {
    let mut from = 0;
    for (index, wanted) in wanted.iter().enumerate() {
        let found = made[from..].iter().position(|made| matches(wanted, made));
        match found {
            Some(at) => from += at + 1,
            None => return Some((index, from)),
        }
    }
    None
}

fn listing(what: &str, lines: Vec<String>) -> String {
    if lines.is_empty() {
        return format!("there were no {what}");
    }
    let numbered = lines
        .iter()
        .enumerate()
        .map(|(n, line)| format!("\n  {}. {line}", n + 1));
    format!("the {what} were:{}", numbered.collect::<String>())
}

/// `wanted` made in this order among `made`.
pub(super) fn calls(wanted: &[Expected], made: &[Call]) -> Result<(), String> {
    let matches = |wanted: &Expected, made: &Call| {
        wanted.method == made.method
            && wanted
                .params
                .as_ref()
                .is_none_or(|params| contains(&made.params, params))
    };
    let Some((index, from)) = first_missing(wanted, made, matches) else {
        return Ok(());
    };
    let expected = &wanted[index];
    let params = expected.params.as_ref().map(shown).unwrap_or_default();
    let after = if from == 0 {
        String::new()
    } else {
        format!(" after call {from}")
    };
    let lines = made.iter().map(call).collect();
    Err(format!(
        "expect.calls[{index}]: no call {} {params}{after}; {}",
        expected.method,
        listing("calls", lines)
    ))
}

/// `wanted` among the items the syncs brought, in this order.
pub(super) fn items(wanted: &[Value], brought: &[Value]) -> Result<(), String> {
    let Some((index, from)) = first_missing(wanted, brought, |w, b| contains(b, w)) else {
        return Ok(());
    };
    let after = if from == 0 {
        String::new()
    } else {
        format!(" after item {from}")
    };
    let lines = brought.iter().map(shown).collect();
    Err(format!(
        "expect.items[{index}]: no item {}{after}; {}",
        shown(&wanted[index]),
        listing("items", lines)
    ))
}
