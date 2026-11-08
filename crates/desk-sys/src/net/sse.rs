//! Server-sent event streams: one GET with `Accept: text/event-stream`, its redirects checked like
//! fetch's, and its events read on the stream's own thread. There is no automatic reconnect: the
//! caller opens again with the last id and the `retry` the server asked for.

use std::collections::BTreeMap;
use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use ureq::http;
use url::Url;

use super::{MAX_REDIRECTS, hosts};
use crate::{Error, ErrorCode};

mod parse;

/// One stream to open.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// An http or https URL.
    pub url: String,
    /// Sent with the GET, except `Accept`, `Cache-Control` and `Last-Event-ID`, which the stream sets.
    pub headers: BTreeMap<String, String>,
    /// Sent as `Last-Event-ID`, and carried by events until the stream names another.
    pub last_event_id: Option<String>,
    /// For opening, redirects included, until the response head arrives; never for the events.
    pub timeout: Option<Duration>,
    /// Host patterns (bridge `HostPattern`) that every URL of the call must match.
    pub allowed_hosts: Vec<String>,
}

/// One event of the stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    /// The `event` field, or `message`.
    pub event: String,
    /// The `data` lines joined with `\n`.
    pub data: String,
    /// The last `id` the stream named so far (or `last_event_id`), "" for none.
    pub id: String,
}

/// What a stream reports, in order. `Closed` comes once and last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Message(Message),
    /// A `retry` field: how long the server asks the caller to wait before opening again.
    Retry(Duration),
    /// The end: the server's (`error` None), `close` or a drop (None), or a failure.
    Closed {
        error: Option<Error>,
    },
}

/// An open stream. Dropping it closes it.
pub struct Stream {
    /// The stream's own agent: shutting it down ends a read blocked on its connection.
    agent: ureq::Agent,
    closed: Arc<AtomicBool>,
}

/// Open a stream and follow redirects (at most `MAX_REDIRECTS`), checking each URL against
/// `allowed_hosts` before connecting. A status other than 200, or a content type other than
/// `text/event-stream`, is `io_error`. `on_event` runs on the stream's own thread and is dropped
/// after `Closed`.
pub fn open(
    request: &Request,
    on_event: impl FnMut(Event) + Send + 'static,
) -> Result<Stream, Error> {
    let mut url = parse(&request.url)?;
    let mut headers = request.headers.clone();
    let agent: ureq::Agent = super::agent_config().build().into();
    let watch = Watch::start(&agent, request.timeout);
    let response = follow(request, &agent, &mut url, &mut headers);
    let response = watch.finish(response, &request.url)?;
    let closed = Arc::new(AtomicBool::new(false));
    let reading = closed.clone();
    let last_id = request.last_event_id.clone().unwrap_or_default();
    let reader = response.into_body().into_reader();
    thread::spawn(move || read(reader, &url, &last_id, &reading, on_event));
    Ok(Stream { agent, closed })
}

impl Stream {
    /// End the stream; `Closed` follows on the stream's thread. Closing twice does nothing.
    pub fn close(&self) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            self.agent.clone().shutdown();
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        self.close();
    }
}

fn parse(text: &str) -> Result<Url, Error> {
    super::parse_as(text, &["http", "https"], "opened as event streams")
}

/// GET each URL until one answers with an event stream.
fn follow(
    request: &Request,
    agent: &ureq::Agent,
    url: &mut Url,
    headers: &mut BTreeMap<String, String>,
) -> Result<http::Response<ureq::Body>, Error> {
    for _ in 0..=MAX_REDIRECTS {
        hosts::check(&request.allowed_hosts, url, &request.url)?;
        let response = get(agent, url, headers, request.last_event_id.as_deref())?;
        let status = response.status().as_u16();
        let location = response.headers().get("location");
        if let (301 | 302 | 303 | 307 | 308, Some(location)) = (status, location) {
            let location = String::from_utf8_lossy(location.as_bytes()).into_owned();
            let next = super::follow(url, &location, parse)?;
            super::redirect_headers(headers, url, &next);
            *url = next;
            continue;
        }
        if status != 200 {
            return Err(Error::new(
                ErrorCode::IoError,
                format!("{url}: status {status}, not an event stream"),
            ));
        }
        let kind = response
            .headers()
            .get("content-type")
            .map(|kind| String::from_utf8_lossy(kind.as_bytes()).into_owned())
            .unwrap_or_default();
        let essence = kind.split(';').next().unwrap_or_default().trim();
        if !essence.eq_ignore_ascii_case("text/event-stream") {
            return Err(Error::new(
                ErrorCode::IoError,
                format!("{url}: content type {kind:?}, not text/event-stream"),
            ));
        }
        return Ok(response);
    }
    Err(Error::new(
        ErrorCode::IoError,
        format!("{}: more than {MAX_REDIRECTS} redirects", request.url),
    ))
}

fn get(
    agent: &ureq::Agent,
    url: &Url,
    headers: &BTreeMap<String, String>,
    last_event_id: Option<&str>,
) -> Result<http::Response<ureq::Body>, Error> {
    let mut builder = http::Request::builder().method("GET").uri(url.as_str());
    for (name, value) in headers {
        let invalid = || Error::new(ErrorCode::InvalidParams, format!("bad header {name:?}"));
        let name = http::HeaderName::from_bytes(name.as_bytes()).map_err(|_| invalid())?;
        let value = http::HeaderValue::from_str(value).map_err(|_| invalid())?;
        // The stream sets these itself.
        if !super::is_one_of(name.as_str(), &["accept", "cache-control", "last-event-id"]) {
            builder = builder.header(name, value);
        }
    }
    builder = builder
        .header("accept", "text/event-stream")
        .header("cache-control", "no-cache");
    if let Some(id) = last_event_id {
        let value = http::HeaderValue::from_str(id).map_err(|_| {
            Error::new(
                ErrorCode::InvalidParams,
                format!("bad last event id {id:?}"),
            )
        })?;
        builder = builder.header("last-event-id", value);
    }
    let request = builder
        .body(())
        .map_err(|err| Error::new(ErrorCode::InvalidParams, format!("{url}: {err}")))?;
    let proxy = super::ureq_proxy(url)?;
    agent
        .run(agent.configure_request(request).proxy(proxy).build())
        .map_err(|err| super::call_error(url, &err))
}

/// Read the body, sending events, then `Closed` last.
fn read(
    mut reader: impl Read,
    url: &Url,
    last_id: &str,
    closed: &AtomicBool,
    mut on_event: impl FnMut(Event),
) {
    let mut parser = parse::Parser::new(last_id);
    let mut buf = vec![0u8; 16 * 1024];
    let error = loop {
        match reader.read(&mut buf) {
            Ok(0) => break None,
            Ok(n) => {
                if let Err(why) = parser.feed(&buf[..n], &mut on_event) {
                    break Some(Error::new(ErrorCode::IoError, format!("{url}: {why}")));
                }
            }
            Err(_) if closed.load(Ordering::SeqCst) => break None,
            Err(err) => break Some(Error::io(&err, url)),
        }
    };
    closed.store(true, Ordering::SeqCst);
    on_event(Event::Closed { error });
}

/// The open's deadline: when it passes before the response head, the stream's agent is shut down,
/// which ends whatever the open is blocked on.
struct Watch {
    state: Arc<AtomicU8>,
    _done: Option<mpsc::Sender<()>>,
}

const WAITING: u8 = 0;
const DONE: u8 = 1;
const FIRED: u8 = 2;

impl Watch {
    fn start(agent: &ureq::Agent, timeout: Option<Duration>) -> Self {
        let state = Arc::new(AtomicU8::new(WAITING));
        let Some(timeout) = timeout else {
            return Self { state, _done: None };
        };
        let (done, wait) = mpsc::channel::<()>();
        let (agent, fired) = (agent.clone(), state.clone());
        let deadline = Instant::now() + timeout;
        thread::spawn(move || {
            let left = deadline.saturating_duration_since(Instant::now());
            if wait.recv_timeout(left) == Err(mpsc::RecvTimeoutError::Timeout)
                && fired
                    .compare_exchange(WAITING, FIRED, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
            {
                agent.shutdown();
            }
        });
        Self {
            state,
            _done: Some(done),
        }
    }

    /// The open's result, or `timeout` when the deadline won.
    fn finish<T>(self, result: Result<T, Error>, requested: &str) -> Result<T, Error> {
        match self
            .state
            .compare_exchange(WAITING, DONE, Ordering::SeqCst, Ordering::SeqCst)
        {
            Ok(_) => result,
            Err(_) => Err(super::timed_out(requested)),
        }
    }
}
