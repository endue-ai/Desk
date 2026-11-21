//! Notifications and notices: a session that LISTENs and then sends nothing receives another
//! session's NOTIFY as soon as it commits; notices a statement raises arrive while it still runs.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use desk_pg_session_spike::session::{Async, field};
use desk_pg_session_spike::{Session, expect, line, plain, title, verdict};
use postgres_protocol::message::backend::Message;

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let info = plain();
    let mut listener = Session::connect(&info).await.expect("listener");
    let mut talker = Session::connect(&info).await.expect("talker");

    title("notify: received while idle");
    listener
        .simple("LISTEN spike_channel")
        .await
        .expect("listen");
    let wait = tokio::spawn(async move {
        let got = tokio::time::timeout(Duration::from_secs(5), listener.recv()).await;
        let at = Instant::now();
        let text = match got {
            Ok(Ok(Message::NotificationResponse(n))) => Some(format!(
                "from pid {} on {}: {:?}",
                n.process_id(),
                n.channel().unwrap(),
                n.message().unwrap()
            )),
            _ => None,
        };
        (text, at, listener)
    });
    tokio::time::sleep(Duration::from_millis(1000)).await;
    talker
        .simple("NOTIFY spike_channel, 'hello while you wait'")
        .await
        .expect("notify");
    let committed = Instant::now();
    let (text, at, mut listener) = wait.await.unwrap();
    line(
        "idle for",
        "1 s, nothing sent, then the other session's NOTIFY committed",
    );
    line(
        "received",
        text.clone().unwrap_or_else(|| "nothing within 5 s".into()),
    );
    line(
        "after the commit",
        format!(
            "{:.2} ms",
            at.saturating_duration_since(committed).as_secs_f64() * 1000.0
        ),
    );
    expect(&mut failures, text.is_some(), "no notification while idle");

    title("notify: notices arrive while the statement runs");
    let sql =
        "DO $$ BEGIN RAISE NOTICE 'first'; PERFORM pg_sleep(1); RAISE NOTICE 'second'; END $$";
    let started = Instant::now();
    listener.simple(sql).await.expect("notices");
    let done = started.elapsed();
    for a in &listener.asyncs {
        if let Async::Notice(fields, at) = a {
            let when = at.duration_since(started).as_secs_f64() * 1000.0;
            line(
                "notice",
                format!("{:?} at {when:.0} ms", field(fields, 'M').unwrap_or("")),
            );
        }
    }
    line(
        "the statement ended at",
        format!("{:.0} ms", done.as_secs_f64() * 1000.0),
    );
    let first = listener.asyncs.iter().find_map(|a| match a {
        Async::Notice(_, at) => Some(at.duration_since(started)),
        _ => None,
    });
    expect(
        &mut failures,
        first.is_some_and(|f| f + Duration::from_millis(500) < done),
        "the first notice came at the end",
    );
    listener.terminate().await.ok();
    talker.terminate().await.ok();
    verdict(&failures)
}
