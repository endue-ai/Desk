//! The endue ID session in the OS keychain (ADR 0239), against the fake auth BFF and a fake
//! keychain: signing in and every renewal keep the tokens in the keychain and leave `account.json`
//! without them, a plain version 2 file moves into the keychain on the next start, signing out
//! deletes the entry, and without a keychain the desk keeps today's private file and says so once.
//! No test touches the person's keychain or the network.

#[path = "account_auth/fake_bff.rs"]
mod fake_bff;
mod support;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use desk_core::account::{Account, AccountLog, AccountOptions, NetIdClient, Screen, State};
use desk_sys::keychain::Keychain;
use desk_sys::keychain::fake::FakeKeychain;
use fake_bff::{Bff, Poll};
use serde_json::{Value, json};
use support::home;

type Lines = Arc<Mutex<Vec<String>>>;

fn options(bff: &Bff, home: &Path, keychain: &Arc<FakeKeychain>, lines: &Lines) -> AccountOptions {
    let mut options = AccountOptions::new(bff.url(), bff.auth_url());
    options.file = Some(home.join("account.json"));
    options.interval_unit = Duration::from_millis(10);
    options.retry = vec![Duration::from_millis(5); 3];
    options.keychain = Some(Arc::clone(keychain) as Arc<dyn Keychain>);
    let lines = Arc::clone(lines);
    options.log = AccountLog::new(move |line| lines.lock().unwrap().push(line.to_owned()));
    options
}

/// The one keychain account the fake platform's session is kept under.
fn key(bff: &Bff) -> String {
    format!("endue-id@127.0.0.1:{}", bff.port)
}

fn sign_in(account: &Account) {
    account.sign_in(Screen::SignIn);
    let until = Instant::now() + Duration::from_secs(5);
    while matches!(account.status().state, State::SigningIn(_)) && Instant::now() < until {
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(account.status().state, State::SignedIn);
}

fn file(home: &Path) -> Value {
    serde_json::from_slice(&fs::read(home.join("account.json")).unwrap()).unwrap()
}

fn secret(keychain: &FakeKeychain, bff: &Bff) -> Value {
    let kept = keychain.secrets().get(&key(bff)).cloned().expect("no keychain entry");
    serde_json::from_str(&kept).unwrap()
}

/// The file holds no token: neither field, nor any token's text.
fn assert_tokenless(home: &Path) {
    let text = fs::read_to_string(home.join("account.json")).unwrap();
    for word in ["accessToken", "refreshCookie", "access1", "rt1", "access2", "rt2"] {
        assert!(!text.contains(word), "{word} in account.json: {text}");
    }
}

fn setup(tag: &str, keychain: FakeKeychain) -> (Bff, std::path::PathBuf, Arc<FakeKeychain>, Lines) {
    let bff = Bff::start();
    bff.script().polls = [Poll::Approve].into();
    (bff, home(tag), Arc::new(keychain), Lines::default())
}

#[test]
fn signing_in_puts_the_tokens_in_the_keychain() {
    let (bff, home, keychain, lines) = setup("kc-sign-in", FakeKeychain::new());
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    sign_in(&account);
    let kept = secret(&keychain, &bff);
    assert_eq!(kept["accessToken"], "access1");
    assert_eq!(kept["refreshCookie"], "rt1");
    assert_tokenless(&home);
    let saved = file(&home);
    assert_eq!(saved["version"], 3);
    assert_eq!(saved["profile"]["displayName"], "Ada Lovelace");
    assert!(lines.lock().unwrap().is_empty(), "{lines:?}");
}

#[test]
fn a_renewal_rotates_the_cookie_in_the_keychain() {
    let (bff, home, keychain, lines) = setup("kc-renew", FakeKeychain::new());
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    sign_in(&account);
    assert_eq!(account.renew().state, State::SignedIn);
    let kept = secret(&keychain, &bff);
    assert_eq!(kept["accessToken"], "access2");
    assert_eq!(kept["refreshCookie"], "rt2");
    assert_tokenless(&home);
    assert_eq!(account.token().as_deref(), Some("access2"));
}

#[test]
fn a_plain_account_json_moves_into_the_keychain() {
    let (bff, home, keychain, lines) = setup("kc-migrate", FakeKeychain::new());
    let plain = json!({ "version": 2, "note": "plain", "accessToken": "access1",
        "refreshCookie": "rt1", "issuedAt": 1, "expiresAt": 4_000_000_000_u64,
        "profile": { "displayName": "Ada" } });
    fs::write(home.join("account.json"), plain.to_string()).unwrap();
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    let status = account.status();
    assert_eq!(status.state, State::SignedIn);
    assert_eq!(status.profile.unwrap().display_name.as_deref(), Some("Ada"));
    assert_eq!(account.token().as_deref(), Some("access1"));
    let kept = secret(&keychain, &bff);
    assert_eq!(kept["accessToken"], "access1");
    assert_eq!(kept["refreshCookie"], "rt1");
    assert_tokenless(&home);
    assert_eq!(file(&home)["version"], 3);
}

#[test]
fn a_reopened_desk_reads_the_session_from_the_keychain() {
    let (bff, home, keychain, lines) = setup("kc-reopen", FakeKeychain::new());
    let first = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    sign_in(&first);
    drop(first);
    let again = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    let status = again.status();
    assert_eq!(status.state, State::SignedIn);
    assert_eq!(
        status.profile.unwrap().display_name.as_deref(),
        Some("Ada Lovelace")
    );
    assert_eq!(again.token().as_deref(), Some("access1"));
}

#[test]
fn signing_out_removes_the_keychain_entry() {
    let (bff, home, keychain, lines) = setup("kc-sign-out", FakeKeychain::new());
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    sign_in(&account);
    assert!(!keychain.secrets().is_empty());
    assert_eq!(account.sign_out().state, State::SignedOut);
    assert!(keychain.secrets().is_empty(), "{:?}", keychain.secrets());
    assert!(!home.join("account.json").exists());
}

#[test]
fn without_a_keychain_the_file_stays_private() {
    let (bff, home, keychain, lines) = setup("kc-fallback", FakeKeychain::unavailable());
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    sign_in(&account);
    assert_eq!(account.renew().state, State::SignedIn);
    let saved = file(&home);
    assert_eq!(saved["version"], 2);
    assert_eq!(saved["accessToken"], "access2");
    assert_eq!(saved["refreshCookie"], "rt2");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(home.join("account.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    // Several saves, one line, and it names the keychain.
    let said = lines.lock().unwrap().clone();
    assert_eq!(said.len(), 1, "{said:?}");
    assert!(said[0].contains("keychain"), "{said:?}");

    // A plain file opened without a keychain is neither migrated nor lost.
    drop(account);
    let again = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    assert_eq!(again.status().state, State::SignedIn);
    assert_eq!(again.token().as_deref(), Some("access2"));
    assert_eq!(file(&home)["version"], 2);
}

#[test]
fn a_keychain_without_its_entry_is_signed_out() {
    let (bff, home, keychain, lines) = setup("kc-missing", FakeKeychain::new());
    let record = json!({ "version": 3, "note": "no tokens here", "issuedAt": 1,
        "expiresAt": 4_000_000_000_u64, "profile": { "displayName": "Ada" } });
    fs::write(home.join("account.json"), record.to_string()).unwrap();
    let account = Account::open(options(&bff, &home, &keychain, &lines), NetIdClient);
    assert_eq!(account.status().state, State::SignedOut);
    assert_eq!(account.token(), None);
}
