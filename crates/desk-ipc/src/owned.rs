//! Who on the socket hears a core event (ADR 0262). An event the core addresses goes only to the
//! connections whose caller it names. An owned event (a turn, a watch, a data subscription, a
//! process, a socket, a web view) goes only to the connection whose call started it, which its
//! answer names, as the runtime routes them to plugins (`packages/runtime/src/owners.ts`): the core
//! sends most of these to nobody in particular. A command's answer goes to the callers named in it.
//! Every other event still reaches every connection (ADR 0030).

use desk_bridge::{BrainTurnKind, BridgeEvent, BridgeRequest, BridgeResponse};
use desk_core::Delivery;

/// Who may hear one delivery over the socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Hears {
    /// Every connection.
    Everyone,
    /// The connections whose caller is one of these.
    Named(Vec<String>),
    /// The connection that claimed this key (a call's answer named it), if its caller may hear it
    /// (`to`, when the core addressed the event); `last` when no event follows for the key.
    Owner {
        key: String,
        to: Option<Vec<String>>,
        last: bool,
    },
}

/// Who may hear `delivery`.
pub(crate) fn hears(delivery: &Delivery) -> Hears {
    if let Some(key) = event_key(&delivery.event) {
        return Hears::Owner {
            key,
            to: delivery.to.clone(),
            last: ends(&delivery.event),
        };
    }
    match (&delivery.event, &delivery.to) {
        (_, Some(to)) => Hears::Named(to.clone()),
        // The answer of a command run names who ran it; it is that caller's.
        (BridgeEvent::CmdAnswered(answered), None) => {
            Hears::Named(vec![answered.data.caller.clone()])
        }
        // The microphone's are always addressed (ADR 0245); one that is not is nobody's.
        (BridgeEvent::AudioFrame(_) | BridgeEvent::AudioEnded(_), None) => Hears::Named(vec![]),
        (_, None) => Hears::Everyone,
    }
}

/// The key an owned event belongs to; `None` for every other event.
pub(crate) fn event_key(event: &BridgeEvent) -> Option<String> {
    Some(match event {
        BridgeEvent::BrainTurn(e) => format!("turn:{}", e.data.turn_id),
        BridgeEvent::FsChanged(e) => format!("watch:{}", e.data.watch_id),
        BridgeEvent::DataChanged(e) => format!("sub:{}", e.data.subscription_id),
        BridgeEvent::ProcOutput(e) => format!("proc:{}", e.data.proc_id),
        BridgeEvent::ProcExit(e) => format!("proc:{}", e.data.proc_id),
        BridgeEvent::NetData(e) => format!("net:{}", e.data.socket_id),
        BridgeEvent::NetClosed(e) => format!("net:{}", e.data.socket_id),
        BridgeEvent::WebChanged(e) => format!("web:{}", e.data.view_id),
        _ => return None,
    })
}

/// Whether no event follows `event` for its key.
fn ends(event: &BridgeEvent) -> bool {
    match event {
        BridgeEvent::BrainTurn(e) => {
            matches!(e.data.kind, BrainTurnKind::Completed | BrainTurnKind::Error)
        }
        BridgeEvent::WebChanged(e) => e.data.closed == Some(true),
        BridgeEvent::ProcExit(_) | BridgeEvent::NetClosed(_) => true,
        _ => false,
    }
}

/// What a request's answer would name: its key's prefix and the result's field that holds the id.
pub(crate) fn claims(request: &BridgeRequest) -> Option<(&'static str, &'static str)> {
    Some(match request {
        BridgeRequest::BrainSay(_) => ("turn", "turnId"),
        BridgeRequest::FsWatch(_) => ("watch", "watchId"),
        BridgeRequest::DataSubscribe(_) => ("sub", "subscriptionId"),
        BridgeRequest::ProcSpawn(_) => ("proc", "procId"),
        BridgeRequest::NetConnect(_) => ("net", "socketId"),
        BridgeRequest::WebOpen(_) => ("web", "viewId"),
        _ => return None,
    })
}

/// The key a successful answer claims for the connection that asked, given `claims` of its request.
pub(crate) fn claimed(claims: Option<(&str, &str)>, answer: &BridgeResponse) -> Option<String> {
    let (prefix, field) = claims?;
    let BridgeResponse::BridgeSuccess(ok) = answer else {
        return None;
    };
    let id = ok.result.get(field)?.as_str()?;
    Some(format!("{prefix}:{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn event(value: Value) -> BridgeEvent {
        serde_json::from_value(value).unwrap()
    }

    fn delivery(value: Value, to: Option<&[&str]>) -> Delivery {
        Delivery {
            to: to.map(|to| to.iter().map(|s| s.to_string()).collect()),
            event: event(value),
        }
    }

    fn request(value: Value) -> BridgeRequest {
        serde_json::from_value(value).unwrap()
    }

    fn success(result: Value) -> BridgeResponse {
        serde_json::from_value(json!({ "id": 1, "ok": true, "result": result })).unwrap()
    }

    #[test]
    fn a_calls_answer_claims_its_turn_watch_subscription_process_socket_or_view() {
        let watch = request(json!({ "id": 1, "method": "fs.watch",
            "params": { "path": "~/a", "scope": { "permission": "fs:read", "paths": ["~/**"] } } }));
        let answer = success(json!({ "watchId": "w-1" }));
        assert_eq!(
            claimed(claims(&watch), &answer).as_deref(),
            Some("watch:w-1")
        );
        let say = request(json!({ "id": 2, "method": "brain.say",
            "params": { "text": "hi", "scope": { "permission": "brain:converse" } } }));
        assert_eq!(
            claimed(claims(&say), &success(json!({ "turnId": "t-9" }))).as_deref(),
            Some("turn:t-9")
        );
        let failure: BridgeResponse = serde_json::from_value(json!({ "id": 2, "ok": false,
            "error": { "code": "permission_denied", "message": "no" } }))
        .unwrap();
        assert_eq!(
            claimed(claims(&say), &failure),
            None,
            "a failure claims nothing"
        );
        let init = request(json!({ "id": 3, "method": "init.get", "params": {} }));
        assert_eq!(claims(&init), None);
    }

    #[test]
    fn an_owned_event_goes_to_its_owner_and_says_when_it_is_the_last() {
        let changed = delivery(
            json!({ "event": "fs.changed",
                "data": { "watchId": "w-1", "path": "~/a/b", "change": "modified" } }),
            None,
        );
        assert_eq!(
            hears(&changed),
            Hears::Owner {
                key: "watch:w-1".into(),
                to: None,
                last: false
            }
        );
        let done = delivery(
            json!({ "event": "brain.turn", "data": { "turnId": "t-9", "kind": "completed" } }),
            None,
        );
        assert!(matches!(hears(&done), Hears::Owner { last: true, .. }));
        let exit = delivery(
            json!({ "event": "proc.exit", "data": { "procId": "p-1", "code": 0 } }),
            Some(&["cli"]),
        );
        assert_eq!(
            hears(&exit),
            Hears::Owner {
                key: "proc:p-1".into(),
                to: Some(vec!["cli".into()]),
                last: true
            }
        );
    }

    #[test]
    fn an_addressed_event_names_its_callers_and_a_command_answer_its_caller() {
        let prompt = delivery(
            json!({ "event": "ui.notified", "data": { "notificationId": "n-1", "caller": "x", "title": "t", "level": "info" } }),
            Some(&["agent:x"]),
        );
        assert_eq!(hears(&prompt), Hears::Named(vec!["agent:x".into()]));
        let notice = delivery(
            json!({ "event": "ui.notified", "data": { "notificationId": "n-1", "caller": "x", "title": "t", "level": "info" } }),
            None,
        );
        assert_eq!(hears(&notice), Hears::Everyone);
        let answered = delivery(
            json!({ "event": "cmd.answered", "data": { "invocationId": "i-1", "id": "a.b",
                "caller": "agent:x", "ok": true } }),
            None,
        );
        assert_eq!(hears(&answered), Hears::Named(vec!["agent:x".into()]));
    }
}
