//! Signing the desk in to endue ID (ADR 0111) against a fake of the platform's auth BFF on
//! 127.0.0.1: the device authorization grant with PKCE S256 and no Origin header, the `endue_rt`
//! cookie taken from Set-Cookie and sent back as Cookie, one refresh at a time with rotation, the
//! 400/401, 403 and transient rules, sign-out that revokes, the profile from /api/v1/users/me,
//! and a reason for every failure. No test touches the network.

#[path = "account_auth/fake_bff.rs"]
mod fake_bff;
mod support;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use desk_core::account::{Account, AccountOptions, NetIdClient, Problem, Screen, Snapshot, State};
use fake_bff::{Bff, PICTURE, Poll, Seen};
use serde_json::json;
use sha2::{Digest, Sha256};
use support::home;

fn options(bff: &Bff, home: &Path) -> AccountOptions {
    let mut options = AccountOptions::new(bff.url(), bff.auth_url());
    options.file = Some(home.join("account.json"));
    options.interval_unit = Duration::from_millis(10);
    options.retry = vec![Duration::from_millis(5); 3];
    options
}

fn open(bff: &Bff, home: &Path) -> Arc<Account> {
    Account::open(options(bff, home), NetIdClient)
}

/// The account once it is no longer signing in, or after five seconds.
fn settled(account: &Account) -> Snapshot {
    let until = Instant::now() + Duration::from_secs(5);
    while Instant::now() < until {
        let status = account.status();
        if !matches!(status.state, State::SigningIn(_)) {
            return status;
        }
        thread::sleep(Duration::from_millis(5));
    }
    account.status()
}

/// An account the fake signed in: cookie `rt1`, access token `access1`.
fn signed_in(bff: &Bff, home: &Path) -> Arc<Account> {
    bff.script().polls = [Poll::Approve].into();
    let account = open(bff, home);
    account.sign_in(Screen::SignIn);
    assert_eq!(settled(&account).state, State::SignedIn);
    account
}

/// Wait until the fake saw `count` requests to `path`.
fn requests(bff: &Bff, path: &str, count: usize) -> Vec<Seen> {
    let until = Instant::now() + Duration::from_secs(5);
    while bff.seen(path).len() < count && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    bff.seen(path)
}

const START: &str = "/api/v1/auth/device/start";
const POLL: &str = "/api/v1/auth/device/token";
const REFRESH: &str = "/api/v1/auth/refresh";

#[test]
fn device_start_sends_pkce_s256_and_no_origin() {
    let bff = Bff::start();
    let account = open(&bff, &home("auth-start"));
    let started = account.sign_in(Screen::SignIn);
    let State::SigningIn(code) = &started.state else {
        panic!("not signing in: {started:?}");
    };
    let page = format!("{}/device", bff.auth_url());
    assert_eq!(code.user_code, "WDJB-MJHT");
    assert_eq!(code.verification_uri, page);
    assert_eq!(
        code.verification_uri_complete,
        format!("{page}?user_code=WDJB-MJHT")
    );
    assert_eq!(code.screen, Screen::SignIn);

    let start = &bff.seen(START)[0];
    assert_eq!(start.headers["content-type"], "application/json");
    assert!(!start.headers.contains_key("origin"), "{:?}", start.headers);
    assert_eq!(start.body["code_challenge_method"], "S256");
    let challenge = start.body["code_challenge"].as_str().unwrap();
    assert_eq!(challenge.len(), 43);
    assert!(
        challenge
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    );

    // The poll proves the challenge: base64url(SHA-256(verifier)), RFC 7636 section 4.2.
    let poll = &requests(&bff, POLL, 1)[0];
    let verifier = poll.body["code_verifier"].as_str().unwrap();
    assert!((43..=128).contains(&verifier.len()));
    let proof = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    assert_eq!(proof, challenge);
    assert_eq!(poll.body["device_code"], "device-1");
    assert!(!poll.headers.contains_key("origin"));

    // Create account while the code waits: the same code, on the page with the sign-up hint.
    let again = account.sign_in(Screen::SignUp);
    let State::SigningIn(code) = &again.state else {
        panic!("not signing in: {again:?}");
    };
    assert_eq!(code.user_code, "WDJB-MJHT");
    assert_eq!(code.screen, Screen::SignUp);
    assert_eq!(
        code.verification_uri_complete,
        format!("{page}?user_code=WDJB-MJHT&prompt=create")
    );
    assert_eq!(bff.seen(START).len(), 1);
    account.sign_out();
}

#[test]
fn device_token_polls_pending_then_slow_down_then_ok() {
    let bff = Bff::start();
    bff.script().polls = [Poll::Pending, Poll::SlowDown, Poll::Approve].into();
    let account = open(&bff, &home("auth-poll"));
    let heard: Arc<Mutex<Vec<Snapshot>>> = Arc::default();
    let keep = heard.clone();
    account.listen(move |snapshot| keep.lock().unwrap().push(snapshot.clone()));

    account.sign_in(Screen::SignIn);
    let done = settled(&account);
    assert_eq!(done.state, State::SignedIn);
    assert_eq!(done.problem, None);
    // The interval endue names is sent back; slow_down adds five (RFC 8628 section 3.5).
    let intervals: Vec<_> = bff
        .seen(POLL)
        .iter()
        .map(|seen| seen.body["interval"].clone())
        .collect();
    assert_eq!(intervals, [json!(1), json!(1), json!(6)]);
    let heard = heard.lock().unwrap();
    assert!(heard.iter().any(|s| {
        matches!(s.state, State::SigningIn(_)) && s.problem == Some(Problem::SlowDown)
    }));
    assert_eq!(heard.last().map(|s| s.state.clone()), Some(State::SignedIn));
    assert_eq!(account.token().as_deref(), Some("access1"));
}

#[test]
fn refresh_rotates_the_cookie_and_runs_once_at_a_time() {
    let bff = Bff::start();
    let home = home("auth-refresh");
    bff.script().access_expires_in = 1; // due at once
    bff.script().refresh_delay = Duration::from_millis(200);
    let account = signed_in(&bff, &home);

    let asking: Vec<_> = (0..8)
        .map(|_| {
            let account = account.clone();
            thread::spawn(move || account.token())
        })
        .collect();
    let tokens: Vec<_> = asking.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(
        tokens.iter().all(|t| t.as_deref() == Some("access2")),
        "{tokens:?}"
    );
    let refreshes = bff.seen(REFRESH);
    assert_eq!(refreshes.len(), 1);
    assert_eq!(bff.script().most_refreshing, 1);
    assert_eq!(refreshes[0].headers["cookie"], "endue_rt=rt1");
    assert!(!refreshes[0].headers.contains_key("origin"));
    let file = fs::read_to_string(home.join("account.json")).unwrap();
    assert!(file.contains("rt2") && !file.contains("rt1"), "{file}");

    // The next renewal sends the rotated cookie and keeps the next one.
    bff.script().refresh_delay = Duration::ZERO;
    assert_eq!(account.renew().state, State::SignedIn);
    assert_eq!(bff.seen(REFRESH)[1].headers["cookie"], "endue_rt=rt2");
    assert_eq!(account.token().as_deref(), Some("access3"));
}

#[test]
fn refresh_401_signs_out_403_keeps_session() {
    let bff = Bff::start();
    let home = home("auth-refresh-rules");
    let account = signed_in(&bff, &home);

    bff.script().refresh.push_back((403, "FORBIDDEN"));
    let kept = account.renew();
    assert_eq!(kept.state, State::SignedIn);
    assert_eq!(kept.problem, Some(Problem::Rejected));
    assert!(kept.profile.is_some());
    assert!(home.join("account.json").exists());
    assert_eq!(account.token().as_deref(), Some("access1"));
    assert_eq!(bff.seen(REFRESH).len(), 1, "a 403 is not retried");

    bff.script().refresh.push_back((401, "AUTH_FAILED"));
    let out = account.renew();
    assert_eq!(out.state, State::SignedOut);
    assert_eq!(out.problem, Some(Problem::SessionExpired));
    assert_eq!(out.profile, None);
    assert_eq!(account.token(), None);
    assert!(!home.join("account.json").exists());

    // A 400 ends it too; any other failure is retried after each of the three waits first.
    let bff = Bff::start();
    let account = signed_in(&bff, &home);
    bff.script().refresh = [(503, "KEYCLOAK_UNAVAILABLE"), (502, "BAD_GATEWAY")].into();
    assert_eq!(account.renew().problem, None);
    assert_eq!(bff.seen(REFRESH).len(), 3);
    assert_eq!(account.token().as_deref(), Some("access2"));
    bff.script().refresh = [(503, "KEYCLOAK_UNAVAILABLE"); 4].into();
    let waiting = account.renew();
    assert_eq!(waiting.state, State::SignedIn);
    assert_eq!(waiting.problem, Some(Problem::Unavailable));
    assert_eq!(bff.seen(REFRESH).len(), 7);
    bff.script().refresh.push_back((400, "VALIDATION_ERROR"));
    assert_eq!(account.renew().problem, Some(Problem::SessionExpired));
}

#[test]
fn sign_out_posts_logout_with_the_refresh_cookie() {
    let bff = Bff::start();
    let home = home("auth-sign-out");
    let account = signed_in(&bff, &home);

    let out = account.sign_out();
    assert_eq!(out.state, State::SignedOut);
    assert_eq!((out.problem, out.profile), (None, None));
    let logout = bff.seen("/api/v1/auth/logout");
    assert_eq!(logout.len(), 1);
    assert_eq!(logout[0].headers["cookie"], "endue_rt=rt1");
    assert!(!logout[0].headers.contains_key("origin"));
    assert_eq!(account.token(), None);
    assert!(!home.join("account.json").exists());

    // Nothing is left to revoke.
    account.sign_out();
    assert_eq!(bff.seen("/api/v1/auth/logout").len(), 1);
}

#[test]
fn profile_comes_from_users_me() {
    let bff = Bff::start();
    let home = home("auth-profile");
    let account = signed_in(&bff, &home);

    let profile = account.status().profile.expect("a profile");
    assert_eq!(profile.display_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(profile.email.as_deref(), Some("ada@example.com"));
    let picture = format!("data:image/png;base64,{}", STANDARD.encode(PICTURE));
    assert_eq!(profile.avatar_url.as_deref(), Some(picture.as_str()));
    let me = bff.seen("/api/v1/users/me");
    assert_eq!(me.len(), 1);
    assert_eq!(me[0].headers["authorization"], "Bearer access1");

    // The session and its profile survive a restart without asking endue again.
    drop(account);
    let again = open(&bff, &home);
    let status = again.status();
    assert_eq!(status.state, State::SignedIn);
    assert_eq!(status.profile, Some(profile));
    assert_eq!(again.token().as_deref(), Some("access1"));
    assert_eq!(bff.seen("/api/v1/users/me").len(), 1);

    // A profile endue cannot hand out leaves the profile out; the sign-in still goes through.
    let bff = Bff::start();
    bff.script().me_status = Some(503);
    let account = signed_in(&bff, &self::home("auth-no-profile"));
    assert_eq!(account.status().profile, None);
}

#[test]
fn expired_device_code_is_a_clear_error() {
    let bff = Bff::start();
    let home = home("auth-expired");
    bff.script().polls = [Poll::Pending, Poll::Fail(410, "DEVICE_CODE_EXPIRED")].into();
    let account = open(&bff, &home);
    account.sign_in(Screen::SignIn);
    let ended = settled(&account);
    assert_eq!(ended.state, State::SignedOut);
    assert_eq!(ended.problem, Some(Problem::Expired));
    assert_eq!(
        Problem::Expired.text(),
        "The sign-in code expired. Sign in again for a new one."
    );

    // A code that runs out on the desk's own clock ends the same way.
    bff.script().expires_in = 1;
    account.sign_in(Screen::SignIn);
    let ended = settled(&account);
    assert_eq!(ended.problem, Some(Problem::Expired));
    assert!(!home.join("account.json").exists());
}

#[test]
fn every_failure_names_its_reason() {
    let polled = |answer: Poll| {
        let bff = Bff::start();
        bff.script().polls = [answer].into();
        let account = open(&bff, &home("auth-reasons"));
        account.sign_in(Screen::SignIn);
        settled(&account).problem
    };
    let denied = Poll::Fail(403, "DEVICE_LOGIN_DENIED");
    assert_eq!(polled(denied), Some(Problem::Denied));
    let suspended = Poll::Fail(403, "ACCOUNT_SUSPENDED");
    assert_eq!(polled(suspended), Some(Problem::Suspended));
    assert_eq!(
        polled(Poll::Fail(401, "AUTH_FAILED")),
        Some(Problem::Failed)
    );

    let started = |errors: Vec<(u16, &'static str)>| {
        let bff = Bff::start();
        bff.script().start = errors.into();
        let account = open(&bff, &home("auth-start-reasons"));
        let status = account.sign_in(Screen::SignIn);
        account.sign_out();
        (status, bff.seen(START).len())
    };
    let (status, tries) = started(vec![(429, "RATE_LIMITED"); 4]);
    assert_eq!(
        (status.state, status.problem, tries),
        (State::SignedOut, Some(Problem::SlowDown), 4)
    );
    let (status, tries) = started(vec![(503, "DEVICE_LOGIN_UNAVAILABLE"); 4]);
    assert_eq!((status.problem, tries), (Some(Problem::Unavailable), 4));
    let (status, tries) = started(vec![(503, "DEVICE_LOGIN_UNAVAILABLE")]);
    assert!(matches!(status.state, State::SigningIn(_)) && tries == 2);

    // Nothing listens on port 1: offline, after the same retries.
    let mut offline = AccountOptions::new("http://127.0.0.1:1", "http://127.0.0.1:1/realms/endue");
    offline.retry = vec![Duration::from_millis(5); 3];
    let account = Account::open(offline, NetIdClient);
    assert_eq!(
        account.sign_in(Screen::SignIn).problem,
        Some(Problem::Offline)
    );

    // A device page that is not on endue ID's host is never opened.
    let bff = Bff::start();
    bff.script().page_host = Some("evil.example".to_owned());
    let account = open(&bff, &home("auth-elsewhere"));
    let status = account.sign_in(Screen::SignIn);
    assert_eq!(
        (status.state, status.problem),
        (State::SignedOut, Some(Problem::Failed))
    );
}

#[test]
fn the_keeper_renews_before_the_token_expires() {
    let bff = Bff::start();
    bff.script().polls = [Poll::Approve].into();
    bff.script().access_expires_in = 2;
    let mut options = options(&bff, &home("auth-keeper"));
    options.lead = Duration::from_secs(1);
    let account = Account::open(options, NetIdClient);
    account.keep_alive();
    account.sign_in(Screen::SignIn);
    assert_eq!(settled(&account).state, State::SignedIn);
    // Nobody asks for the token: the keeper renews it a second before it expires.
    assert_eq!(requests(&bff, REFRESH, 1).len(), 1);
    assert_eq!(bff.seen(REFRESH)[0].headers["cookie"], "endue_rt=rt1");
}
