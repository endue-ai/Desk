//! Cancel stops the statement on the server: a second session sees `SELECT pg_sleep(30)` active in
//! pg_stat_activity, the cancel request goes on a connection of its own with the backend's key, the
//! statement ends with 57014, and pg_stat_activity shows the backend idle while the session goes
//! on. Inside a transaction, the cancel leaves the transaction failed (ReadyForQuery `E`).

use std::process::ExitCode;
use std::time::{Duration, Instant};

use desk_pg_session_spike::session::{cancel, field};
use desk_pg_session_spike::{Session, expect, line, plain, title, verdict};

async fn activity(observer: &mut Session, pid: i32) -> Vec<Option<String>> {
    let sql = "SELECT state, query, wait_event FROM pg_stat_activity WHERE pid = $1::int";
    let pid = pid.to_string();
    let page = observer
        .open(sql, &[Some(&pid)], 0)
        .await
        .expect("pg_stat_activity");
    page.rows.into_iter().next().unwrap_or_default()
}

/// Run `sql` on `s` in a task, cancel it after `after`, and answer the SQLSTATE, how long after
/// the cancel it ended, the ReadyForQuery status and the session.
async fn run_and_cancel(
    observer: &mut Session,
    mut s: Session,
    sql: &'static str,
    failures: &mut Vec<String>,
) -> (Option<String>, Duration, u8, Session) {
    let (info, pid, key) = (s.info.clone(), s.pid, s.key);
    let task = tokio::spawn(async move {
        let answer = s.simple(sql).await;
        (answer, Instant::now(), s)
    });
    let mut before = Vec::new();
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(20)).await;
        before = activity(observer, pid).await;
        if before.first().cloned().flatten().as_deref() == Some("active") {
            break;
        }
    }
    line("before the cancel, pg_stat_activity", format!("{before:?}"));
    expect(
        failures,
        before.first().cloned().flatten().as_deref() == Some("active"),
        "the statement never showed active",
    );
    let sent = Instant::now();
    cancel(&info, pid, key).await.expect("cancel request");
    let (answer, ended, s) = task.await.unwrap();
    let (outcomes, status) = answer.expect("the session answered");
    let code = outcomes
        .iter()
        .find_map(|o| o.error.as_ref())
        .and_then(|f| field(f, 'C').map(str::to_owned));
    (code, ended - sent, status, s)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let info = plain();
    let mut observer = Session::connect(&info).await.expect("observer");
    let s = Session::connect(&info).await.expect("session");
    let pid = s.pid;

    title("cancel: SELECT pg_sleep(30) outside a transaction");
    let started = Instant::now();
    let (code, latency, status, mut s) =
        run_and_cancel(&mut observer, s, "SELECT pg_sleep(30)", &mut failures).await;
    line(
        "statement ended",
        format!(
            "{code:?}, {:.1} ms after the cancel was sent, {:.2} s after it began",
            latency.as_secs_f64() * 1000.0,
            started.elapsed().as_secs_f64()
        ),
    );
    line("ReadyForQuery status", status as char);
    let after = activity(&mut observer, pid).await;
    line("after the cancel, pg_stat_activity", format!("{after:?}"));
    expect(
        &mut failures,
        code.as_deref() == Some("57014"),
        "not query_canceled",
    );
    expect(
        &mut failures,
        after.first().cloned().flatten().as_deref() == Some("idle"),
        "the backend is not idle",
    );
    let next = s
        .open("SELECT 'still here'", &[], 0)
        .await
        .expect("the session goes on");
    line(
        "the next statement on the session",
        format!("{:?}", next.rows[0]),
    );

    title("cancel: inside a transaction");
    s.simple("BEGIN").await.expect("begin");
    let (code, latency, status, mut s) =
        run_and_cancel(&mut observer, s, "SELECT pg_sleep(30)", &mut failures).await;
    line(
        "statement ended",
        format!(
            "{code:?}, {:.1} ms after the cancel",
            latency.as_secs_f64() * 1000.0
        ),
    );
    line(
        "ReadyForQuery status",
        format!(
            "{} (E: the transaction failed, only ROLLBACK goes on)",
            status as char
        ),
    );
    expect(
        &mut failures,
        status == b'E',
        "the transaction is not failed",
    );
    let (rolled, status) = s.simple("ROLLBACK").await.expect("rollback");
    line(
        "ROLLBACK",
        format!("{:?} then status {}", rolled[0].tag, status as char),
    );
    s.terminate().await.ok();
    observer.terminate().await.ok();
    verdict(&failures)
}
