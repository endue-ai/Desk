//! Sign-in with SCRAM: the mechanisms the server offers, the one used, the time to ReadyForQuery,
//! the parameters the server reports, and a wrong password's error. Over TLS (`SPIKE_TLS_URI`),
//! SCRAM-SHA-256-PLUS binds the sign-in to the server's certificate.

use std::process::ExitCode;
use std::time::Duration;

use desk_pg_session_spike::{ConnInfo, Session, expect, line, plain, title, verdict};

async fn median(info: &ConnInfo, times: usize) -> (Duration, Session) {
    let mut all = Vec::new();
    let mut last = None;
    for _ in 0..times {
        let s = Session::connect(info).await.expect("sign-in");
        all.push(s.sign_in);
        if let Some(old) = last.replace(s) {
            old.terminate().await.ok();
        }
    }
    all.sort();
    (all[times / 2], last.unwrap())
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let mut failures = Vec::new();
    title("signin: SCRAM-SHA-256 over plain TCP");
    let info = plain();
    let (time, s) = median(&info, 20).await;
    line("offered", s.offered.join(", "));
    line("used", &s.mechanism);
    line(
        "median of 20 sign-ins",
        format!("{:.1} ms", time.as_secs_f64() * 1000.0),
    );
    line(
        "backend key data",
        format!("pid {}, a 32-bit secret for cancel requests", s.pid),
    );
    let reported: Vec<String> = s.server.iter().map(|(k, v)| format!("{k}={v}")).collect();
    line("parameters the server reported", reported.join("; "));
    expect(
        &mut failures,
        s.mechanism == "SCRAM-SHA-256",
        format!("signed in with {}", s.mechanism),
    );
    s.terminate().await.ok();

    let mut wrong = info.clone();
    wrong.password.push('x');
    match Session::connect(&wrong).await {
        Err(e) => {
            line("wrong password", format!("{e:?}"));
            expect(
                &mut failures,
                e.code() == Some("28P01"),
                "a wrong password is 28P01",
            );
        }
        Ok(_) => failures.push("a wrong password signed in".into()),
    }

    if let Ok(tls) = ConnInfo::from_env("SPIKE_TLS_URI") {
        title("signin: SCRAM-SHA-256-PLUS over TLS verify-full");
        let (time, s) = median(&tls, 20).await;
        line("offered", s.offered.join(", "));
        line("used", &s.mechanism);
        line(
            "median of 20 sign-ins with the TLS handshake",
            format!("{:.1} ms", time.as_secs_f64() * 1000.0),
        );
        expect(
            &mut failures,
            s.mechanism == "SCRAM-SHA-256-PLUS",
            format!("signed in with {}", s.mechanism),
        );
        s.terminate().await.ok();
    }
    verdict(&failures)
}
