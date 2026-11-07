//! The Linux notifier over freedesktop notifications: `org.freedesktop.Notifications` on D-Bus.
//! Freedesktop has no permission, so the notifier is always `Authorized`. `Notify` answers the
//! server's id for each post; `ActionInvoked` with the `default` action on one of those ids is a
//! click, and `NotificationClosed` forgets the id. One thread per notifier hears both signals.
//!
//! zbus runs on Tokio, as for the vendored single-instance plugin: `zbus::block_on` drives zbus's own
//! Tokio runtime, and it panics on a thread that already drives one, as a caller's may. So every
//! blocking D-Bus call runs on a short thread of its own, never the caller's.

use std::collections::{BTreeMap, HashMap};
use std::future::poll_fn;
use std::pin::{Pin, pin};
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::task::{Context, Poll, Waker};
use std::thread;
use std::time::Duration;

use futures_core::Stream;
use zbus::connection::Builder;
use zbus::message::Type;
use zbus::{Connection, MatchRule, Message, MessageStream, Variant};

use super::{Authorization, Click, ClickHandler, ClickSlot, Notification, Notifier, NotifyLevel};
use crate::{Error, ErrorCode};

const DESTINATION: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const INTERFACE: &str = "org.freedesktop.Notifications";
/// The action a server reports for a click on the notification itself, with the label a server
/// shows if it draws the default action as a button.
const DEFAULT_ACTION: [&str; 2] = ["default", "Open"];
/// How long a call on the session bus waits for its answer: the D-Bus reference implementation's.
const CALL_TIMEOUT: Duration = Duration::from_secs(25);
/// How many posted ids a notifier keeps for a server that never reports them closed.
const REMEMBERED: usize = 1024;

/// A notifier for the server on `connection`.
pub struct Freedesktop {
    connection: Connection,
    app_name: String,
    /// The server takes markup in the body (`body-markup`), so a body is escaped.
    markup: bool,
    shared: Arc<Shared>,
}

/// What the notifier shares with its thread.
#[derive(Default)]
struct Shared {
    clicks: ClickSlot,
    /// The desk's id and the server that answered (its unique name on a bus), by the server's id.
    posted: Mutex<BTreeMap<u32, (String, Option<String>)>>,
    stop: Stop,
}

impl Freedesktop {
    /// A notifier on `connection`, the session bus or a peer-to-peer connection to a server, posting
    /// as `app_name`. It subscribes to the server's signals and asks for its capabilities (no answer
    /// is plain text) before it returns. Dropping it ends its thread and leaves the connection open.
    pub fn new(connection: Connection, app_name: &str) -> Result<Self, Error> {
        let shared = Arc::new(Shared::default());
        let (ready, started) = mpsc::channel();
        let (listening, sharing) = (connection.clone(), Arc::clone(&shared));
        thread::Builder::new()
            .name("desk-sys notifications".to_owned())
            .spawn(move || listen(listening, sharing, ready))
            .map_err(|err| Error::io(&err, "starting the notification thread"))?;
        let markup = started.recv().map_err(|_| {
            Error::new(
                ErrorCode::IoError,
                "the notification thread ended before it subscribed",
            )
        })??;
        Ok(Self {
            connection,
            app_name: app_name.to_owned(),
            markup,
            shared,
        })
    }

    /// `new` on the session bus; `unsupported` when no session bus is reachable.
    pub(super) fn session(app_name: &str) -> Result<Self, Error> {
        let session = Builder::session().method_timeout(CALL_TIMEOUT).build();
        let connection = blocking(|| zbus::block_on(session))?.map_err(|err| {
            Error::new(
                ErrorCode::Unsupported,
                format!("freedesktop notifications need a D-Bus session bus: {err}"),
            )
        })?;
        Self::new(connection, app_name)
    }

    fn posted(&self) -> MutexGuard<'_, BTreeMap<u32, (String, Option<String>)>> {
        self.shared.posted()
    }
}

impl Drop for Freedesktop {
    fn drop(&mut self) {
        self.shared.stop.request();
    }
}

impl Notifier for Freedesktop {
    fn authorization(&self) -> Authorization {
        Authorization::Authorized
    }

    fn request_authorization(&self) -> Result<Authorization, Error> {
        Ok(Authorization::Authorized)
    }

    /// Critical urgency for `error` and normal otherwise; the server's own timeout.
    fn post(&self, notification: &Notification) -> Result<(), Error> {
        let body = notification.body.as_deref().unwrap_or_default();
        let body = if self.markup {
            escape(body)
        } else {
            body.to_owned()
        };
        let urgency: u8 = if notification.level == NotifyLevel::Error {
            2
        } else {
            1
        };
        let reply = blocking(|| {
            let hints = HashMap::from([("urgency", Variant::from(urgency))]);
            let args = (
                self.app_name.as_str(),
                0u32,
                "",
                notification.title.as_str(),
                body.as_str(),
                DEFAULT_ACTION.to_vec(),
                hints,
                -1i32,
            );
            let call = self.connection.call_method(
                Some(DESTINATION),
                PATH,
                Some(INTERFACE),
                "Notify",
                &args,
            );
            zbus::block_on(call)
        })?
        .map_err(|err| failed("Notify", &err))?;
        let id: u32 = reply
            .body()
            .deserialize()
            .map_err(|err| failed("reading Notify's answer", &err))?;
        let server = reply.header().sender().map(|sender| sender.to_string());
        let mut posted = self.posted();
        posted.insert(id, (notification.id.clone(), server));
        while posted.len() > REMEMBERED {
            posted.pop_first();
        }
        Ok(())
    }

    fn on_click(&self, handler: ClickHandler) {
        self.shared.clicks.set(handler);
    }
}

/// The notifier's thread: subscribes, reports the server's capabilities through `ready`, then hears
/// signals until the notifier is dropped or the connection closes.
fn listen(connection: Connection, shared: Arc<Shared>, ready: mpsc::Sender<Result<bool, Error>>) {
    zbus::block_on(async move {
        let rule = MatchRule::builder()
            .msg_type(Type::Signal)
            .path(PATH)
            .interface(INTERFACE)
            .build();
        let subscribed = match rule {
            Ok(rule) => MessageStream::for_match_rule(rule, &connection, None).await,
            Err(err) => Err(err),
        };
        let stream = match subscribed {
            Ok(stream) => stream,
            Err(err) => {
                let _ = ready.send(Err(failed("subscribing to the server's signals", &err)));
                return;
            }
        };
        let markup = capabilities(&connection)
            .await
            .iter()
            .any(|c| c == "body-markup");
        let _ = ready.send(Ok(markup));
        drop(ready);
        let mut stream = pin!(stream);
        while let Some(message) = next(stream.as_mut(), &shared.stop).await {
            if let Ok(message) = message {
                shared.handle(&message);
            }
        }
    });
}

async fn capabilities(connection: &Connection) -> Vec<String> {
    let reply = connection
        .call_method(
            Some(DESTINATION),
            PATH,
            Some(INTERFACE),
            "GetCapabilities",
            &(),
        )
        .await;
    reply
        .ok()
        .and_then(|reply| reply.body().deserialize::<Vec<String>>().ok())
        .unwrap_or_default()
}

/// The next signal, or `None` once the notifier is dropped or the connection closed.
async fn next(mut stream: Pin<&mut MessageStream>, stop: &Stop) -> Option<zbus::Result<Message>> {
    poll_fn(|cx| {
        if stop.requested(cx) {
            Poll::Ready(None)
        } else {
            stream.as_mut().poll_next(cx)
        }
    })
    .await
}

impl Shared {
    fn posted(&self) -> MutexGuard<'_, BTreeMap<u32, (String, Option<String>)>> {
        self.posted.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A signal counts only from the server that answered the post it names.
    fn handle(&self, message: &Message) {
        let header = message.header();
        let sender = header.sender().map(|sender| sender.to_string());
        let body = message.body();
        match header.member().map(|member| member.as_str()) {
            Some("ActionInvoked") => {
                let Ok((id, action)) = body.deserialize::<(u32, String)>() else {
                    return;
                };
                let desk_id = match self.posted().get(&id) {
                    Some((desk_id, server)) if action == "default" && *server == sender => {
                        desk_id.clone()
                    }
                    _ => return,
                };
                self.clicks.fire(Click { id: desk_id });
            }
            Some("NotificationClosed") => {
                let Ok((id, _reason)) = body.deserialize::<(u32, u32)>() else {
                    return;
                };
                let mut posted = self.posted();
                if posted.get(&id).is_some_and(|(_, server)| *server == sender) {
                    posted.remove(&id);
                }
            }
            _ => {}
        }
    }
}

/// Asked by `Freedesktop::drop`; wakes the thread waiting for the next signal.
#[derive(Default)]
struct Stop(Mutex<(bool, Option<Waker>)>);

impl Stop {
    fn request(&self) {
        let waker = {
            let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
            state.0 = true;
            state.1.take()
        };
        if let Some(waker) = waker {
            waker.wake();
        }
    }

    /// Whether a stop was asked; if not, the task is woken when it is.
    fn requested(&self, cx: &Context<'_>) -> bool {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if !state.0 {
            state.1 = Some(cx.waker().clone());
        }
        state.0
    }
}

/// Runs `work` on a thread of its own, which drives no runtime, and waits for it.
fn blocking<T: Send>(work: impl FnOnce() -> T + Send) -> Result<T, Error> {
    thread::scope(|scope| {
        let call = thread::Builder::new()
            .name("desk-sys d-bus call".to_owned())
            .spawn_scoped(scope, work)
            .map_err(|err| Error::io(&err, "starting a D-Bus call"))?;
        call.join()
            .map_err(|_| Error::new(ErrorCode::IoError, "a D-Bus call panicked"))
    })
}

fn failed(what: &str, err: &zbus::Error) -> Error {
    Error::new(
        ErrorCode::IoError,
        format!("freedesktop notifications: {what}: {err}"),
    )
}

/// The body as markup that shows `text` as written: the servers' markup is a subset of XML.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            c => escaped.push(c),
        }
    }
    escaped
}
