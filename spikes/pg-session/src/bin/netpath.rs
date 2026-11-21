//! The second way: the plugin speaks the protocol itself over the bridge's sockets (`net.*`, ADR
//! 0133), which move bytes and nothing else. This check does only what a frame could do with them:
//! raw bytes on a TCP connection. TLS starts after the SSLRequest byte exchange, and from that byte
//! on the socket must carry a TLS handshake that the frame would have to implement itself.

use std::process::ExitCode;

use bytes::BytesMut;
use desk_pg_session_spike::{ConnInfo, Session, expect, line, mib, plain, title, verdict};
use postgres_protocol::message::frontend;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const SQL: &str = "SELECT g AS id, md5(g::text) AS hash, g * 0.5 AS half, now() AS at FROM generate_series(1, 1000000) g";

/// SSLRequest on a bare socket: the one byte the server answers.
async fn ssl_answer(info: &ConnInfo) -> (TcpStream, u8) {
    let mut tcp = TcpStream::connect((info.host.as_str(), info.port))
        .await
        .expect("tcp");
    let mut out = BytesMut::new();
    frontend::ssl_request(&mut out);
    tcp.write_all(&out).await.unwrap();
    let mut answer = [0u8; 1];
    tcp.read_exact(&mut answer).await.unwrap();
    (tcp, answer[0])
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    title("netpath: what the bridge's sockets offer");
    let schema =
        std::fs::read_to_string("../../specs/bridge/v0/net.schema.json").unwrap_or_default();
    let names: Vec<&str> = schema
        .split("\"const\": \"")
        .skip(1)
        .filter_map(|s| s.split('"').next())
        .filter(|s| s.starts_with("net."))
        .collect();
    line(
        "net.* methods and events in specs/bridge/v0",
        names.join(", "),
    );
    expect(
        &mut failures,
        !names
            .iter()
            .any(|n| n.contains("tls") || n.contains("upgrade")),
        "the bridge gained a TLS method",
    );

    if let Ok(info) = ConnInfo::from_env("SPIKE_TLS_URI") {
        title("netpath: a server with TLS");
        let (mut tcp, answer) = ssl_answer(&info).await;
        line(
            "SSLRequest (8 bytes) answered",
            format!("{:?}", answer as char),
        );
        let mut startup = BytesMut::new();
        frontend::startup_message(
            [("user", info.user.as_str()), ("database", "postgres")],
            &mut startup,
        )
        .unwrap();
        tcp.write_all(&startup).await.unwrap();
        let mut rest = Vec::new();
        let read = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tcp.read_to_end(&mut rest),
        )
        .await;
        line(
            "a startup message where the ClientHello must go",
            format!(
                "{} bytes back, then {}",
                rest.len(),
                if read.is_ok() {
                    "the server closed the connection"
                } else {
                    "silence"
                }
            ),
        );
        expect(
            &mut failures,
            answer == b'S',
            "the TLS server did not answer S",
        );
    }

    title("netpath: a server without TLS");
    let info = plain();
    let (_tcp, answer) = ssl_answer(&info).await;
    line(
        "SSLRequest answered",
        format!(
            "{:?} (plain text from here, the only session a frame can hold)",
            answer as char
        ),
    );
    let mut s = Session::connect(&info).await.expect("plain session");
    let before = s.read_bytes;
    let mut page = s.open(SQL, &[], 10000).await.expect("rows");
    while page.tag.is_none() {
        page = s.more(10000).await.expect("rows");
    }
    let wire = s.read_bytes - before;
    let events = wire.div_ceil(64 * 1024);
    line("1,000,000 rows on the wire", mib(wire));
    line(
        "through net.data",
        format!(
            "{events} events of 64 KiB, {} of base64 in JSON, each decoded and parsed in the frame",
            mib(wire.div_ceil(3) * 4)
        ),
    );
    s.terminate().await.ok();
    verdict(&failures)
}
