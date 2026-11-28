//! What the desk's log says when endue refuses a sign-in: the endpoint, the status and the
//! envelope's error code, so a "Sign-in failed" can be told apart afterwards. Never a body, a
//! device code, the PKCE verifier or a token. No test touches the network.

#[path = "account_auth/fake_bff.rs"]
mod fake_bff;
mod support;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use desk_core::account::{
    Account, AccountLog, AccountOptions, NetIdClient, Problem, Screen, Snapshot, State,
};
use fake_bff::{Bff, Poll};
use support::home;

/// An account on `bff` whose log lines land in the returned list.
fn logged(bff: &Bff, tag: &str) -> (Arc<Account>, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let mut options = AccountOptions::new(bff.url(), bff.auth_url());
    options.file = Some(home(tag).join("account.json"));
    options.interval_unit = Duration::from_millis(10);
    options.retry = vec![Duration::from_millis(5); 3];
    let sink = Arc::clone(&lines);
    options.log = AccountLog::new(move |line| sink.lock().unwrap().push(line.to_owned()));
    (Account::open(options, NetIdClient), lines)
}

fn settled(account: &Account) -> Snapshot {
    let until = Instant::now() + Duration::from_secs(5);
    while matches!(account.status().state, State::SigningIn(_)) && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    account.status()
}

fn text(lines: &Mutex<Vec<String>>) -> String {
    lines.lock().unwrap().join("\n")
}

#[test]
fn a_refused_poll_logs_its_status_and_code() {
    let bff = Bff::start();
    bff.script().polls = [Poll::Fail(403, "ACCOUNT_PENDING_APPROVAL")].into();
    let (account, lines) = logged(&bff, "auth-log-poll");
    account.sign_in(Screen::SignIn);
    assert_eq!(settled(&account).problem, Some(Problem::PendingApproval));
    let log = text(&lines);
    assert!(
        log.contains("/api/v1/auth/device/token answered 403 ACCOUNT_PENDING_APPROVAL"),
        "{log}"
    );
    let verifier = bff.seen("/api/v1/auth/device/token")[0].body["code_verifier"]
        .as_str()
        .unwrap()
        .to_owned();
    for secret in ["device-1", verifier.as_str(), "from the fake"] {
        assert!(!log.contains(secret), "the log carries {secret:?}: {log}");
    }
}

#[test]
fn a_refused_start_logs_its_status_and_code() {
    let bff = Bff::start();
    bff.script().start = [(403, "REGION_UNAVAILABLE")].into();
    let (account, lines) = logged(&bff, "auth-log-start");
    let status = account.sign_in(Screen::SignIn);
    assert_eq!(status.problem, Some(Problem::RegionUnavailable));
    let log = text(&lines);
    assert!(
        log.contains("/api/v1/auth/device/start answered 403 REGION_UNAVAILABLE"),
        "{log}"
    );
}

#[test]
fn a_device_page_elsewhere_is_logged_by_its_origin() {
    let bff = Bff::start();
    bff.script().page_host = Some("evil.example".to_owned());
    let (account, lines) = logged(&bff, "auth-log-elsewhere");
    assert_eq!(
        account.sign_in(Screen::SignIn).problem,
        Some(Problem::Failed)
    );
    let log = text(&lines);
    assert!(log.contains("http://evil.example"), "{log}");
    assert!(
        !log.contains("WDJB-MJHT"),
        "the log carries the user code: {log}"
    );
}

#[test]
fn a_signed_in_desk_logs_nothing_of_its_tokens() {
    let bff = Bff::start();
    bff.script().polls = [Poll::Pending, Poll::Approve].into();
    let (account, lines) = logged(&bff, "auth-log-ok");
    account.sign_in(Screen::SignIn);
    assert_eq!(settled(&account).state, State::SignedIn);
    let log = text(&lines);
    for secret in ["access1", "rt1", "device-1"] {
        assert!(!log.contains(secret), "the log carries {secret:?}: {log}");
    }
}
