//! desk-sys freedesktop notifications (feature `notification`, Linux only): `Freedesktop` against an
//! `org.freedesktop.Notifications` server in this process, on the other end of `UnixStream::pair()` as
//! a peer-to-peer zbus connection. No session bus and no notification daemon are involved.
#![cfg(target_os = "linux")]

use std::collections::HashMap;
use std::os::unix::net::UnixStream;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use desk_sys::notification::freedesktop::Freedesktop;
use desk_sys::notification::{Authorization, Click, Notification, Notifier, NotifyLevel};
use zbus::connection::Builder;
use zbus::{Connection, Guid, OwnedVariant};

const PATH: &str = "/org/freedesktop/Notifications";
const INTERFACE: &str = "org.freedesktop.Notifications";
/// Long enough for a loaded runner; a test that passes never waits this long.
const WAIT: Duration = Duration::from_secs(20);

/// One `Notify` call as the server received it.
#[derive(Debug, Clone, PartialEq)]
struct Notify {
    app_name: String,
    replaces_id: u32,
    app_icon: String,
    summary: String,
    body: String,
    actions: Vec<String>,
    urgency: Option<u8>,
    expire_timeout: i32,
}

/// The server's side: what it answers and what it was asked.
#[derive(Clone)]
struct Server {
    capabilities: Vec<String>,
    next_id: Arc<Mutex<u32>>,
    methods: Arc<Mutex<Vec<String>>>,
    notifies: Arc<Mutex<Vec<Notify>>>,
}

impl Server {
    fn new(capabilities: &[&str], first_id: u32) -> Self {
        Self {
            capabilities: capabilities.iter().map(|c| (*c).to_owned()).collect(),
            next_id: Arc::new(Mutex::new(first_id)),
            methods: Arc::default(),
            notifies: Arc::default(),
        }
    }

    fn methods(&self) -> Vec<String> {
        self.methods.lock().unwrap().clone()
    }

    fn notifies(&self) -> Vec<Notify> {
        self.notifies.lock().unwrap().clone()
    }
}

#[zbus::interface(name = "org.freedesktop.Notifications")]
impl Server {
    #[allow(clippy::too_many_arguments)]
    fn notify(
        &self,
        app_name: String,
        replaces_id: u32,
        app_icon: String,
        summary: String,
        body: String,
        actions: Vec<String>,
        hints: HashMap<String, OwnedVariant>,
        expire_timeout: i32,
    ) -> u32 {
        self.methods.lock().unwrap().push("Notify".to_owned());
        let urgency = hints.get("urgency").and_then(|v| u8::try_from(v).ok());
        self.notifies.lock().unwrap().push(Notify {
            app_name,
            replaces_id,
            app_icon,
            summary,
            body,
            actions,
            urgency,
            expire_timeout,
        });
        let mut next = self.next_id.lock().unwrap();
        let id = *next;
        *next += 1;
        id
    }

    fn get_capabilities(&self) -> Vec<String> {
        self.methods
            .lock()
            .unwrap()
            .push("GetCapabilities".to_owned());
        self.capabilities.clone()
    }

    fn close_notification(&self, _id: u32) {
        self.methods
            .lock()
            .unwrap()
            .push("CloseNotification".to_owned());
    }

    fn get_server_information(&self) -> (String, String, String, String) {
        self.methods
            .lock()
            .unwrap()
            .push("GetServerInformation".to_owned());
        let info = ("test", "endue", "1", "1.2");
        (info.0.into(), info.1.into(), info.2.into(), info.3.into())
    }
}

/// The server's connection and the client's, joined peer to peer over a socket pair.
fn connect(server: Server) -> (Connection, Connection) {
    let (server_socket, client_socket) = UnixStream::pair().unwrap();
    let serving = thread::spawn(move || {
        zbus::block_on(
            Builder::unix_stream(server_socket)
                .server(Guid::generate())
                .p2p()
                .serve_at(PATH, server)
                .build(),
        )
    });
    let client = zbus::block_on(Builder::unix_stream(client_socket).p2p().build()).unwrap();
    let server = serving.join().unwrap().unwrap();
    (server, client)
}

fn action_invoked(server: &Connection, id: u32, action: &str) {
    let signal = server.emit_signal(
        None::<&str>,
        PATH,
        INTERFACE,
        "ActionInvoked",
        &(id, action),
    );
    zbus::block_on(signal).unwrap();
}

fn notification_closed(server: &Connection, id: u32, reason: u32) {
    let signal = server.emit_signal(
        None::<&str>,
        PATH,
        INTERFACE,
        "NotificationClosed",
        &(id, reason),
    );
    zbus::block_on(signal).unwrap();
}

fn notification(id: &str, title: &str, body: Option<&str>, level: NotifyLevel) -> Notification {
    Notification {
        id: id.to_owned(),
        title: title.to_owned(),
        body: body.map(str::to_owned),
        level,
    }
}

fn clicks(notifier: &Freedesktop) -> Receiver<Click> {
    let (sender, receiver) = mpsc::channel();
    notifier.on_click(Box::new(move |click| {
        let _ = sender.send(click);
    }));
    receiver
}

#[test]
fn post_calls_notify_with_the_summary_body_urgency_and_default_action() {
    let server = Server::new(&["actions", "body"], 1);
    let (_server, client) = connect(server.clone());
    let notifier = Freedesktop::new(client, "endue Desk").unwrap();
    let before = server.methods();

    assert_eq!(notifier.authorization(), Authorization::Authorized);
    assert_eq!(
        notifier.request_authorization(),
        Ok(Authorization::Authorized)
    );
    assert_eq!(
        server.methods(),
        before,
        "freedesktop has no permission to ask for"
    );

    let failed = notification("n-1", "Build failed", Some("3 tests"), NotifyLevel::Error);
    notifier.post(&failed).unwrap();
    notifier
        .post(&notification("n-2", "Saved", None, NotifyLevel::Info))
        .unwrap();

    let notifies = server.notifies();
    assert_eq!(notifies.len(), 2, "one Notify per post: {notifies:?}");
    let expected = |summary: &str, body: &str, urgency: u8| Notify {
        app_name: "endue Desk".to_owned(),
        replaces_id: 0,
        app_icon: String::new(),
        summary: summary.to_owned(),
        body: body.to_owned(),
        actions: notifies[0].actions.clone(),
        urgency: Some(urgency),
        expire_timeout: -1,
    };
    assert_eq!(notifies[0], expected("Build failed", "3 tests", 2));
    assert_eq!(notifies[1], expected("Saved", "", 1));
    for notify in &notifies {
        let keys: Vec<&str> = notify
            .actions
            .iter()
            .step_by(2)
            .map(String::as_str)
            .collect();
        assert_eq!(keys, ["default"], "{:?}", notify.actions);
        assert_eq!(notify.actions.len(), 2, "an action is a key and a label");
    }
}

#[test]
fn a_server_with_body_markup_gets_the_body_escaped() {
    let server = Server::new(&["actions", "body", "body-markup"], 1);
    let (_server, client) = connect(server.clone());
    let notifier = Freedesktop::new(client, "endue Desk").unwrap();

    notifier
        .post(&notification(
            "n-1",
            "a <b> & c",
            Some("x <i>y</i> & z"),
            NotifyLevel::Info,
        ))
        .unwrap();

    let notifies = server.notifies();
    assert_eq!(
        notifies[0].summary, "a <b> & c",
        "the summary is never markup"
    );
    assert_eq!(notifies[0].body, "x &lt;i&gt;y&lt;/i&gt; &amp; z");
}

#[test]
fn action_invoked_default_reaches_the_click_handler_with_the_desk_id() {
    let server = Server::new(&["actions", "body"], 7);
    let (server_connection, client) = connect(server.clone());
    let notifier = Freedesktop::new(client, "endue Desk").unwrap();
    let clicked = clicks(&notifier);
    notifier
        .post(&notification("n-1", "first", None, NotifyLevel::Info))
        .unwrap();

    action_invoked(&server_connection, 7, "default");
    assert_eq!(
        clicked.recv_timeout(WAIT),
        Ok(Click {
            id: "n-1".to_owned()
        })
    );

    // None of these may call the handler: an id the server never gave, an action that is not the
    // default, and a click on a notification the server closed.
    action_invoked(&server_connection, 99, "default");
    action_invoked(&server_connection, 7, "snooze");
    notification_closed(&server_connection, 7, 2);
    action_invoked(&server_connection, 7, "default");

    // Signals are handled in order, so the next click the handler sees is this one.
    notifier
        .post(&notification("n-2", "second", None, NotifyLevel::Info))
        .unwrap();
    action_invoked(&server_connection, 8, "default");
    assert_eq!(
        clicked.recv_timeout(WAIT),
        Ok(Click {
            id: "n-2".to_owned()
        })
    );
    assert!(clicked.try_recv().is_err(), "one call per click");
}
