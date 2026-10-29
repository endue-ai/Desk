//! The wire (ADR 0030): one compact JSON document per `\n`-terminated UTF-8 line, no handshake and no
//! wrapper. A request line is a `BridgeRequest`, an answer line a `BridgeResponse`, an event line a
//! `BridgeEvent`; a reader tells the last two apart by `id` versus `event`.

use std::io;

use desk_bridge::{
    BridgeError, BridgeEvent, BridgeFailure, BridgeRequest, BridgeResponse, ErrorCode, False,
    RequestId,
};
use serde_json::Value;

/// The request on one line, or the `invalid_params` answer for a line that is not one (with the
/// line's `id` when it can be read, `0` otherwise). `None` for an empty line, which gets no answer.
pub(crate) fn request(line: &[u8]) -> Option<Result<BridgeRequest, BridgeResponse>> {
    let line = line.trim_ascii();
    if line.is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_slice(line) {
        Ok(value) => value,
        Err(why) => return Some(Err(invalid(0, format!("not a JSON line: {why}")))),
    };
    let id = value.get("id").and_then(Value::as_u64).unwrap_or(0);
    let message = match value.get("method").and_then(Value::as_str) {
        Some(method) => format!("not a bridge request: no method {method} with these params"),
        None => "not a bridge request: it needs an id, a method and params".to_owned(),
    };
    Some(serde_json::from_value(value).map_err(|_| invalid(id, message)))
}

fn invalid(id: RequestId, message: String) -> BridgeResponse {
    BridgeResponse::BridgeFailure(BridgeFailure {
        id,
        ok: False,
        error: BridgeError {
            code: ErrorCode::InvalidParams,
            message,
            permission: None,
        },
    })
}

/// An answer as one line, `\n` included.
pub(crate) fn answer_line(answer: &BridgeResponse) -> Option<String> {
    serde_json::to_string(answer).ok().map(terminated)
}

/// An event as one line, `\n` included.
pub(crate) fn event_line(event: &BridgeEvent) -> Option<String> {
    serde_json::to_string(event).ok().map(terminated)
}

/// A request as one line, `\n` included.
pub(crate) fn request_line(request: &BridgeRequest) -> io::Result<String> {
    serde_json::to_string(request)
        .map(terminated)
        .map_err(|why| io::Error::new(io::ErrorKind::InvalidInput, why.to_string()))
}

fn terminated(mut line: String) -> String {
    line.push('\n');
    line
}

/// One line the desk sent, with the line itself (without its `\n`) for callers that print it.
pub(crate) enum Incoming {
    Answer(BridgeResponse, String),
    Event(BridgeEvent, String),
    /// An event this build does not know (a newer desk), or an empty line.
    Skipped,
}

pub(crate) fn incoming(mut line: String) -> io::Result<Incoming> {
    while line.ends_with(['\n', '\r']) {
        line.pop();
    }
    if line.trim().is_empty() {
        return Ok(Incoming::Skipped);
    }
    let value: Value = serde_json::from_str(&line).map_err(bad_line)?;
    if value.get("event").is_some() {
        return Ok(match serde_json::from_value(value) {
            Ok(event) => Incoming::Event(event, line),
            Err(_) => Incoming::Skipped,
        });
    }
    let answer = serde_json::from_value(value).map_err(bad_line)?;
    Ok(Incoming::Answer(answer, line))
}

pub(crate) fn request_id(request: &BridgeRequest) -> RequestId {
    serde_json::to_value(request)
        .ok()
        .and_then(|value| value.get("id").and_then(Value::as_u64))
        .unwrap_or(0)
}

pub(crate) fn answer_id(answer: &BridgeResponse) -> RequestId {
    match answer {
        BridgeResponse::BridgeSuccess(ok) => ok.id,
        BridgeResponse::BridgeFailure(failure) => failure.id,
    }
}

fn bad_line(why: serde_json::Error) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("the desk sent a line that is not a bridge answer or event: {why}"),
    )
}
