//! A single text turn against the configured public brain v0 service.
use std::process::ExitCode;
use std::sync::mpsc;
use std::time::Duration;

use desk_brain::{
    Brain, BrainFailure, ClientInfo, CreateSessionRequest, LeaseAcquireRequest, LeaseHolder,
    StopReason, TextPart, TurnEvent, TurnRequest, UserMessage,
};
use desk_brain_endue::HttpBrain;

const TIME_LIMIT: Duration = Duration::from_secs(120);

pub(crate) fn run(prompt: String, json: bool) -> ExitCode {
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let _ = send.send(configured().and_then(|brain| turn(&brain, prompt)));
    });
    let result = match receive.recv_timeout(TIME_LIMIT) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("the runtime exceeded the two-minute turn limit")
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("the runtime request stopped unexpectedly")
        }
    };
    match result {
        Ok(text) => {
            if json {
                println!("{}", serde_json::json!({ "ok": true, "text": text }));
            } else {
                println!("{text}");
            }
            ExitCode::SUCCESS
        }
        Err(reason) => {
            eprintln!("{}: run: {reason}", crate::name());
            ExitCode::from(1)
        }
    }
}

fn configured() -> Result<HttpBrain, &'static str> {
    let url = std::env::var("ENDUE_BRAIN_URL")
        .or_else(|e| match e {
            std::env::VarError::NotPresent => std::env::var("DESK_BRAIN_URL"),
            _ => Err(e),
        })
        .map_err(|_| "set ENDUE_BRAIN_URL to the runtime's public brain v0 endpoint")?;
    let brain = HttpBrain::new(&url)
        .map_err(|_| "ENDUE_BRAIN_URL must be an HTTP or HTTPS base URL without credentials, a query or a fragment")?;
    let token = match std::env::var("ENDUE_BRAIN_TOKEN") {
        Err(std::env::VarError::NotPresent) => return Ok(brain),
        Err(_) => return Err("ENDUE_BRAIN_TOKEN must be a valid bearer token"),
        Ok(token) if token.is_empty() => return Ok(brain),
        Ok(token) => token,
    };
    if !token.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("ENDUE_BRAIN_TOKEN must be a valid bearer token");
    }
    if !brain.is_secure_or_loopback() {
        return Err("use HTTPS for ENDUE_BRAIN_TOKEN or connect to a loopback runtime");
    }
    Ok(brain.with_token(token))
}

fn turn(brain: &impl Brain, prompt: String) -> Result<String, &'static str> {
    let session = brain
        .create_session(&CreateSessionRequest {
            title: None,
            client: ClientInfo {
                name: "endue".into(),
                version: crate::version().into(),
            },
        })
        .map_err(reason)?;
    let lease = brain
        .acquire_lease(
            &session.id,
            &LeaseAcquireRequest {
                holder: LeaseHolder {
                    desk_id: "endue-cli".into(),
                    name: None,
                },
                ttl_seconds: TIME_LIMIT.as_secs(),
                takeover: None,
            },
        )
        .map_err(reason)?;
    let request = TurnRequest {
        lease_id: lease.lease_id,
        message: UserMessage {
            role: Default::default(),
            content: vec![TextPart {
                r#type: Default::default(),
                text: prompt,
            }],
        },
        tools: None,
        tool_choice: None,
        context: None,
    };
    let mut answer = String::new();
    let mut completed = false;
    let mut failure = None;
    let result = brain.create_turn(&session.id, &request, &mut |event| {
        if failure.is_some() {
            return;
        }
        if completed {
            failure = Some("the runtime sent more events after completing the turn");
            return;
        }
        match event {
            TurnEvent::TurnStarted(_) => {}
            TurnEvent::TextDelta(delta) => answer.push_str(&delta.text),
            TurnEvent::ToolCall(_) => {
                failure = Some("this text command cannot run the requested tool")
            }
            TurnEvent::TurnCompleted(event) => match event.stop_reason {
                StopReason::EndTurn => completed = true,
                StopReason::ToolCall => {
                    failure = Some("this text command cannot run the requested tool")
                }
                StopReason::MaxTokens => failure = Some("the runtime reached its output limit"),
                StopReason::Cancelled => failure = Some("the runtime cancelled the turn"),
            },
            TurnEvent::TurnError(_) => failure = Some("the runtime reported a failed turn"),
        }
    });
    let released = brain.release_lease(&session.id, &request.lease_id);
    result.map_err(reason)?;
    if let Some(message) = failure {
        return Err(message);
    }
    if !completed {
        return Err("the runtime ended before completing the turn");
    }
    released.map_err(reason)?;
    Ok(answer)
}

fn reason(failure: BrainFailure) -> &'static str {
    match failure {
        BrainFailure::Refused {
            status: 401 | 403, ..
        } => "the runtime refused access. Check ENDUE_BRAIN_TOKEN and the service permissions",
        BrainFailure::Refused { status: 429, .. } => "the runtime is rate limited. Try again later",
        BrainFailure::Refused { .. } => {
            "the runtime refused the request. Check its endpoint and permissions"
        }
        BrainFailure::Unreachable(_) => {
            "could not reach the runtime or finish its response. Check ENDUE_BRAIN_URL"
        }
        BrainFailure::Protocol(_) => {
            "the response does not match the public brain v0 contract. Check ENDUE_BRAIN_URL"
        }
    }
}
