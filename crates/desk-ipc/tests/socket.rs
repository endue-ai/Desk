//! The desk socket (ADR 0030): an in-process `Core` behind `Listener::bind`, spoken to in raw
//! newline-delimited JSON over a `UnixStream`. Every request is the caller `cli`; every core event
//! reaches every connected client; a malformed line is answered and the connection stays open.

#[cfg(windows)]
#[test]
fn bind_is_unsupported_on_windows() {
    use std::sync::Arc;

    use desk_core::{Core, Roots};
    let core = Arc::new(Core::new(Roots {
        home: std::env::temp_dir(),
    }));
    let path = std::env::temp_dir().join("desk-ipc-windows.sock");
    match desk_ipc::Listener::bind(&path, core) {
        Ok(_) => panic!("the socket is not available on Windows yet"),
        Err(why) => assert_eq!(why.kind(), std::io::ErrorKind::Unsupported),
    }
    match desk_ipc::Client::connect(&path) {
        Ok(_) => panic!("the socket is not available on Windows yet"),
        Err(why) => assert_eq!(why.kind(), std::io::ErrorKind::Unsupported),
    }
}

#[cfg(unix)]
mod unix {
    use std::fs;
    use std::io::{BufRead, BufReader, ErrorKind, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, Instant};

    use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse, Permission};
    use desk_core::{Core, Roots};
    use desk_ipc::{CALLER, Client, Listener};
    use serde_json::{Value, json};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A fresh socket path under the temp folder (macOS limits a socket path to 104 bytes).
    fn socket() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("dipc-{}-{n}.sock", std::process::id()))
    }

    fn core() -> Arc<Core> {
        Arc::new(Core::new(Roots {
            home: std::env::temp_dir(),
        }))
    }

    fn serve() -> (Arc<Core>, Listener, PathBuf) {
        let core = core();
        let path = socket();
        let listener = Listener::bind(&path, Arc::clone(&core)).expect("bind the desk socket");
        (core, listener, path)
    }

    fn permission(value: Value) -> Permission {
        serde_json::from_value(value).unwrap()
    }

    /// One raw connection: write lines, read lines.
    struct Conn {
        reader: BufReader<UnixStream>,
        writer: UnixStream,
    }

    impl Conn {
        fn open(path: &PathBuf) -> Self {
            let stream = UnixStream::connect(path).expect("connect to the desk socket");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            Self {
                reader: BufReader::new(stream.try_clone().unwrap()),
                writer: stream,
            }
        }

        fn send(&mut self, line: &str) {
            self.writer.write_all(line.as_bytes()).unwrap();
            self.writer.write_all(b"\n").unwrap();
        }

        fn line(&mut self) -> Value {
            let mut line = String::new();
            let read = self.reader.read_line(&mut line).expect("a line in time");
            assert!(read > 0, "the desk closed the connection");
            assert!(line.ends_with('\n'), "lines end with \\n: {line:?}");
            serde_json::from_str(&line).unwrap_or_else(|e| panic!("{e}: {line:?}"))
        }

        /// The next answer line, reading past event lines.
        fn answer(&mut self) -> Value {
            loop {
                let line = self.line();
                if line.get("id").is_some() {
                    return line;
                }
            }
        }

        /// Nothing more arrives within a short wait.
        fn quiet(&mut self) {
            self.reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_millis(200)))
                .unwrap();
            let mut line = String::new();
            match self.reader.read_line(&mut line) {
                Err(e) => assert!(
                    matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut),
                    "{e}"
                ),
                Ok(_) => panic!("expected nothing, got {line:?}"),
            }
            self.reader
                .get_ref()
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
        }

        /// One init.get round trip: the connection is served (and hears events) from here on.
        fn ping(&mut self, id: u64) {
            self.send(&json!({ "id": id, "method": "init.get", "params": {} }).to_string());
            assert_eq!(self.answer()["id"], id);
        }
    }

    #[test]
    fn a_request_line_is_answered_on_the_same_connection() {
        let (core, _listener, path) = serve();
        let mut conn = Conn::open(&path);
        conn.send(r#"{"id":1,"method":"init.get","params":{}}"#);
        let answer = conn.line();
        assert_eq!(answer["id"], 1);
        assert_eq!(answer["ok"], true);
        assert_eq!(answer["result"]["profile"], json!(core.init().profile));
        conn.quiet();
    }

    #[test]
    fn the_caller_is_cli_so_the_permission_engine_applies() {
        assert_eq!(CALLER, "cli");
        let (core, _listener, path) = serve();
        let mut conn = Conn::open(&path);
        let list = |id: u64| {
            json!({
                "id": id,
                "method": "cmd.list",
                "params": { "scope": { "permission": "cmd:invoke", "ids": ["*"] } }
            })
            .to_string()
        };
        conn.send(&list(1));
        let denied = conn.answer();
        assert_eq!(denied["ok"], false);
        assert_eq!(denied["error"]["code"], "permission_denied");

        let grant = core.grant(
            CALLER,
            permission(json!({ "permission": "cmd:invoke", "ids": ["*"] })),
        );
        conn.send(&list(2));
        let listed = conn.answer();
        assert_eq!(listed["id"], 2);
        assert_eq!(listed["ok"], true, "{listed}");

        conn.send(r#"{"id":3,"method":"perm.query","params":{}}"#);
        let grants = conn.answer();
        assert_eq!(grants["id"], 3);
        let ids: Vec<&Value> = grants["result"]["grants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| &g["grantId"])
            .collect();
        assert_eq!(ids, [&json!(grant.grant_id)]);
    }

    #[test]
    fn two_clients_get_their_own_answers() {
        let (_core, _listener, path) = serve();
        let mut a = Conn::open(&path);
        let mut b = Conn::open(&path);
        a.send(r#"{"id":7,"method":"init.get","params":{}}"#);
        b.send(r#"{"id":8,"method":"init.get","params":{}}"#);
        assert_eq!(a.line()["id"], 7);
        assert_eq!(b.line()["id"], 8);
        a.quiet();
        b.quiet();
    }

    #[test]
    fn a_core_event_reaches_every_connected_client() {
        let (core, _listener, path) = serve();
        let mut a = Conn::open(&path);
        let mut b = Conn::open(&path);
        a.ping(1);
        b.ping(1);
        let grant = core.grant("desk", permission(json!({ "permission": "plugin:manage" })));
        for conn in [&mut a, &mut b] {
            let event = conn.line();
            assert_eq!(event["event"], "perm.changed", "{event}");
            assert_eq!(event["data"]["grantId"], json!(grant.grant_id));
            assert_eq!(event["data"]["change"], "granted");
        }
    }

    #[test]
    fn a_malformed_line_is_answered_invalid_params_and_the_connection_stays_open() {
        let (_core, _listener, path) = serve();
        let mut conn = Conn::open(&path);
        conn.send("not json");
        let unreadable = conn.line();
        assert_eq!(unreadable["id"], 0);
        assert_eq!(unreadable["ok"], false);
        assert_eq!(unreadable["error"]["code"], "invalid_params");
        assert!(unreadable["error"]["message"].is_string());

        conn.send(r#"{"id":5,"method":"nope","params":{}}"#);
        let unknown = conn.line();
        assert_eq!(unknown["id"], 5);
        assert_eq!(unknown["ok"], false);
        assert_eq!(unknown["error"]["code"], "invalid_params");

        conn.send("");
        conn.send(r#"{"id":6,"method":"init.get","params":{}}"#);
        let answer = conn.line();
        assert_eq!(answer["id"], 6, "an empty line gets nothing: {answer}");
        assert_eq!(answer["ok"], true);
    }

    #[test]
    fn a_client_that_stops_reading_is_dropped_and_the_desk_runs_on() {
        let (core, _listener, path) = serve();
        let mut slow = Conn::open(&path);
        slow.ping(1);
        // Far more than the socket buffer and the 1000-line queue hold.
        let published = 20_000;
        for _ in 0..published {
            core.grant("desk", permission(json!({ "permission": "plugin:manage" })));
        }
        // Once its queue is full the desk hangs up, and writing fails. Empty lines get no answer.
        let deadline = Instant::now() + Duration::from_secs(10);
        while slow.writer.write_all(b"\n").is_ok() {
            assert!(Instant::now() < deadline, "the slow client was not dropped");
            std::thread::sleep(Duration::from_millis(10));
        }
        let mut received = 0;
        loop {
            let mut line = String::new();
            match slow.reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => received += 1,
                Err(e) => panic!("the slow client was not dropped: {e} after {received} lines"),
            }
        }
        assert!(received < published, "dropped after {received} lines");
        Conn::open(&path).ping(2);
    }

    #[test]
    fn the_socket_file_is_the_owners_only() {
        let (_core, _listener, path) = serve();
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "mode {mode:o}");
    }

    #[test]
    fn bind_replaces_a_stale_socket_file_and_removes_its_own_on_drop() {
        let path = socket();
        drop(UnixListener::bind(&path).unwrap());
        assert!(path.exists(), "a crashed desk leaves its socket file");
        assert!(UnixStream::connect(&path).is_err(), "nothing serves it");

        let listener = Listener::bind(&path, core()).expect("a stale file is replaced");
        Conn::open(&path).ping(1);
        drop(listener);
        assert!(!path.exists(), "the listener removes its file");
        assert!(UnixStream::connect(&path).is_err());
    }

    #[test]
    fn a_second_desk_on_a_served_path_is_refused() {
        let (_core, _listener, path) = serve();
        match Listener::bind(&path, core()) {
            Ok(_) => panic!("two desks on one socket"),
            Err(why) => assert_eq!(why.kind(), ErrorKind::AddrInUse),
        }
        Conn::open(&path).ping(1);
    }

    #[test]
    fn the_client_speaks_the_same_wire() {
        let (core, _listener, path) = serve();
        let mut client = Client::connect(&path).expect("connect");
        let init_get = |id: u64| -> BridgeRequest {
            serde_json::from_value(json!({ "id": id, "method": "init.get", "params": {} })).unwrap()
        };
        match client.call(init_get(1)).unwrap() {
            BridgeResponse::BridgeSuccess(ok) => {
                assert_eq!(ok.id, 1);
                assert_eq!(ok.result["profile"], json!(core.init().profile));
            }
            BridgeResponse::BridgeFailure(err) => panic!("{err:?}"),
        }

        let grant = core.grant("desk", permission(json!({ "permission": "plugin:manage" })));
        // The event may arrive before or after this answer; the client keeps it either way.
        assert!(matches!(
            client.call(init_get(2)).unwrap(),
            BridgeResponse::BridgeSuccess(ok) if ok.id == 2
        ));
        match client.next_event().unwrap() {
            BridgeEvent::PermChanged(event) => assert_eq!(event.data.grant_id, grant.grant_id),
            other => panic!("{other:?}"),
        }
    }
}
