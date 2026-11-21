//! TLS: `verify-full` against a server whose certificate a throwaway authority signed for
//! `localhost` (`SPIKE_TLS_URI`); refused for a name the certificate does not hold and for an
//! authority nobody signed with (`SPIKE_TLS_OTHER_CA`); `verify-ca` accepts the chain under any
//! name; a cancel request over TLS stops a statement.

use std::process::ExitCode;
use std::time::{Duration, Instant};

use desk_pg_session_spike::session::cancel;
use desk_pg_session_spike::{ConnInfo, Session, SslMode, expect, line, title, verdict};

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    let Ok(info) = ConnInfo::from_env("SPIKE_TLS_URI") else {
        println!("== tls: SPIKE_TLS_URI is not set, skipped");
        return ExitCode::SUCCESS;
    };
    title("tls: verify-full with the server's own authority");
    let mut s = Session::connect(&info).await.expect("verify-full sign-in");
    let done = s.tls.as_ref().expect("TLS");
    line("negotiated", format!("{} {}", done.version, done.suite));
    line("signed in with", &s.mechanism);
    line(
        "sign-in including the handshake",
        format!("{:.1} ms", s.sign_in.as_secs_f64() * 1000.0),
    );
    let (out, _) = s
        .simple("SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
        .await
        .expect("pg_stat_ssl");
    let seen = out[0].rows[0]
        .iter()
        .map(|v| v.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    line("pg_stat_ssl says", seen.join(" "));
    expect(
        &mut failures,
        seen.first().map(String::as_str) == Some("t"),
        "pg_stat_ssl shows no TLS",
    );

    title("tls: cancel over TLS");
    let (pid, key) = (s.pid, s.key);
    let task = tokio::spawn(async move {
        let started = Instant::now();
        let answer = s.simple("SELECT pg_sleep(30)").await;
        (answer, started.elapsed(), s)
    });
    tokio::time::sleep(Duration::from_millis(300)).await;
    let sent = Instant::now();
    cancel(&info, pid, key).await.expect("cancel request");
    let (answer, total, s) = task.await.unwrap();
    let code = answer
        .ok()
        .and_then(|(o, _)| o.first().and_then(|o| o.error.clone()))
        .and_then(|f| f.iter().find(|(c, _)| *c == 'C').map(|(_, v)| v.clone()));
    line(
        "statement ended",
        format!(
            "{code:?} {:.0} ms after the cancel, {:.2} s after it began",
            sent.elapsed().as_secs_f64() * 1000.0,
            total.as_secs_f64()
        ),
    );
    expect(
        &mut failures,
        code.as_deref() == Some("57014"),
        "the cancel did not stop pg_sleep",
    );
    s.terminate().await.ok();

    title("tls: refusals");
    let mut by_address = info.clone();
    by_address.host = "127.0.0.1".into();
    match Session::connect(&by_address).await {
        Err(e) => line(
            "verify-full to 127.0.0.1 (not in the certificate)",
            format!("{e:?}"),
        ),
        Ok(_) => failures.push("verify-full accepted a name the certificate does not hold".into()),
    }
    if let Ok(path) = std::env::var("SPIKE_TLS_OTHER_CA") {
        let mut other = info.clone();
        other.ca_pem = Some(std::fs::read(path).expect("the other authority"));
        match Session::connect(&other).await {
            Err(e) => line("verify-full with another authority", format!("{e:?}")),
            Ok(_) => failures.push("verify-full accepted an authority nobody signed with".into()),
        }
    }
    let mut chain_only = by_address.clone();
    chain_only.sslmode = SslMode::VerifyCa;
    match Session::connect(&chain_only).await {
        Ok(s) => {
            line(
                "verify-ca to 127.0.0.1",
                "signed in (the chain is checked, the name is not)",
            );
            s.terminate().await.ok();
        }
        Err(e) => failures.push(format!("verify-ca refused: {e:?}")),
    }
    let mut unchecked = by_address.clone();
    unchecked.sslmode = SslMode::Require;
    unchecked.ca_pem = None;
    match Session::connect(&unchecked).await {
        Ok(s) => {
            line(
                "require without an authority",
                format!("signed in over {}", s.tls.as_ref().unwrap().version),
            );
            s.terminate().await.ok();
        }
        Err(e) => failures.push(format!("require refused: {e:?}")),
    }
    verdict(&failures)
}
