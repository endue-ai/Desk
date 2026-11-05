//! The desk's endue ID (ADR 0089): account.* signs in by the device authorization grant (RFC 8628)
//! against a scripted endue ID, keeps the token in a file only this user reads, refreshes it once it
//! has expired, and tells holders of account:manage about every change. The token never crosses
//! the bridge.

mod support;

use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_core::Core;
use desk_core::account::{Account, AccountOptions, DECLINED, IdClient, RAN_OUT, State};
use desk_sys::Error;
use desk_sys::shell::Opener;
use serde_json::{Value, json};
use support::*;

/// endue ID from a script: each post takes the next answer and is kept as `url?form`.
#[derive(Clone, Default)]
struct Script {
    answers: Arc<Mutex<VecDeque<(u16, Value)>>>,
    posts: Arc<Mutex<Vec<String>>>,
}

impl Script {
    fn new(answers: Vec<(u16, Value)>) -> Self {
        Self {
            answers: Arc::new(Mutex::new(answers.into())),
            posts: Arc::default(),
        }
    }
    fn posts(&self) -> Vec<String> {
        self.posts.lock().unwrap().clone()
    }
}

impl IdClient for Script {
    fn post_form(&self, url: &str, form: &[(&str, &str)]) -> Result<(u16, Value), String> {
        let form: Vec<String> = form.iter().map(|(k, v)| format!("{k}={v}")).collect();
        self.posts
            .lock()
            .unwrap()
            .push(format!("{url}?{}", form.join("&")));
        let pending = (400, json!({ "error": "authorization_pending" }));
        Ok(self.answers.lock().unwrap().pop_front().unwrap_or(pending))
    }
}

#[derive(Clone, Default)]
struct Opened(Arc<Mutex<Vec<String>>>);

impl Opener for Opened {
    fn open_url(&self, url: &str) -> Result<(), Error> {
        self.0.lock().unwrap().push(url.to_owned());
        Ok(())
    }
    fn reveal(&self, _path: &Path) -> Result<(), Error> {
        Ok(())
    }
}

fn device_code() -> (u16, Value) {
    let code = json!({ "device_code": "dev1", "user_code": "WDJB-MJHT",
        "verification_uri": "https://id.example/device",
        "verification_uri_complete": "https://id.example/device?user_code=WDJB-MJHT",
        "expires_in": 600, "interval": 0 });
    (200, code)
}

fn token(access: &str, expires_in: u64) -> (u16, Value) {
    let token = json!({ "access_token": access, "token_type": "Bearer",
        "refresh_token": "refresh1", "expires_in": expires_in });
    (200, token)
}

fn account(home: &Path, script: &Script) -> Arc<Account> {
    let mut options = AccountOptions::new("https://id.example/");
    options.file = Some(home.join("account.json"));
    options.interval = Duration::from_millis(5);
    Account::open(options, script.clone())
}

fn core(account: &Arc<Account>, home: &Path, opened: &Opened) -> Arc<Core> {
    let core = Core::new(roots(home))
        .with_opener(opened.clone())
        .with_account(account.clone());
    let core = Arc::new(core);
    core.start_account();
    grant(&core, "desk", json!({ "permission": "account:manage" }));
    core
}

fn scope() -> Value {
    json!({ "scope": { "permission": "account:manage" } })
}

/// The account once it is no longer signing in, or after two seconds.
fn settled(account: &Account) -> desk_core::account::Snapshot {
    for _ in 0..400 {
        let status = account.status();
        if !matches!(status.state, State::SigningIn(_)) {
            return status;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    account.status()
}

#[test]
fn signing_in_shows_the_code_opens_the_page_and_keeps_the_token() {
    let home = home("account-sign-in");
    let script = Script::new(vec![
        device_code(),
        (400, json!({ "error": "authorization_pending" })),
        token("access1", 3600),
    ]);
    let account = account(&home, &script);
    let opened = Opened::default();
    let core = core(&account, &home, &opened);
    let deliveries = core.events().subscribe_addressed();

    let started = call(&core, "desk", "account.signIn", scope()).unwrap();
    assert_eq!(started["state"], "signing-in");
    assert_eq!(started["signIn"]["userCode"], "WDJB-MJHT");
    let page = "https://id.example/device?user_code=WDJB-MJHT";
    assert_eq!(*opened.0.lock().unwrap(), [page]);

    assert_eq!(settled(&account).state, State::SignedIn);
    assert_eq!(account.token().as_deref(), Some("access1"));
    let status = call(&core, "desk", "account.status", scope()).unwrap();
    assert_eq!(status, json!({ "state": "signed-in" }));
    let posts = script.posts();
    assert!(posts[0].starts_with("https://id.example/oauth/device/code?client_id=endue-desk"));
    assert!(posts[2].contains("grant_type=urn:ietf:params:oauth:grant-type:device_code"));
    assert!(posts[2].contains("device_code=dev1"));

    // The state changes before its event goes out: wait for both events.
    let changed = [
        wait_for(&deliveries, "account.changed"),
        wait_for(&deliveries, "account.changed"),
    ];
    assert!(changed.iter().all(|d| d.is_for("desk")));
    let states: Vec<&Value> = changed.iter().map(|d| &d.data()["state"]).collect();
    assert_eq!(states, ["signing-in", "signed-in"]);
    let file = fs::read_to_string(home.join("account.json")).unwrap();
    assert!(file.contains("access1"));
    assert!(
        changed
            .iter()
            .all(|d| !d.data().to_string().contains("access1"))
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(home.join("account.json"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn a_sign_in_turned_down_in_the_browser_says_so() {
    let home = home("account-declined");
    let script = Script::new(vec![
        device_code(),
        (400, json!({ "error": "access_denied" })),
    ]);
    let account = account(&home, &script);
    let core = core(&account, &home, &Opened::default());
    call(&core, "desk", "account.signIn", scope()).unwrap();
    let status = settled(&account);
    assert_eq!(status.state, State::SignedOut);
    assert_eq!(status.problem.as_deref(), Some(DECLINED));
    assert_eq!(account.token(), None);
}

#[test]
fn the_token_is_refreshed_once_it_has_expired_and_a_dead_refresh_signs_out() {
    let home = home("account-refresh");
    let script = Script::new(vec![
        device_code(),
        token("access1", 0),
        token("access2", 3600),
    ]);
    let account = account(&home, &script);
    account.sign_in().unwrap();
    assert_eq!(settled(&account).state, State::SignedIn);
    assert_eq!(account.token().as_deref(), Some("access2"));
    assert!(
        script
            .posts()
            .last()
            .unwrap()
            .contains("grant_type=refresh_token")
    );

    // A new desk run reads the file; its refresh token is no longer known to endue ID.
    let script = Script::new(vec![(400, json!({ "error": "invalid_grant" }))]);
    let stale = r#"{ "version": 1, "note": "", "accessToken": "old", "refreshToken": "r", "expiresAt": 1 }"#;
    fs::write(home.join("account.json"), stale).unwrap();
    let again = self::account(&home, &script);
    assert_eq!(again.status().state, State::SignedIn);
    assert_eq!(again.token(), None);
    assert_eq!(again.status().state, State::SignedOut);
    assert_eq!(again.status().problem.as_deref(), Some(RAN_OUT));
    assert!(!home.join("account.json").exists());
}

#[test]
fn signing_out_forgets_the_token_and_only_the_runtime_may_ask() {
    let home = home("account-sign-out");
    let script = Script::new(vec![device_code(), token("access1", 3600)]);
    let account = account(&home, &script);
    let core = core(&account, &home, &Opened::default());
    call(&core, "desk", "account.signIn", scope()).unwrap();
    assert_eq!(settled(&account).state, State::SignedIn);

    let refused = call(&core, "endue.mail", "account.signOut", scope()).unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );
    let out = call(&core, "desk", "account.signOut", scope()).unwrap();
    assert_eq!(out, json!({ "state": "signed-out" }));
    assert_eq!(account.token(), None);
    assert!(!home.join("account.json").exists());
}

#[test]
fn a_desk_without_an_account_does_not_serve_it() {
    let home = home("account-none");
    let core = Core::new(roots(&home));
    grant(&core, "desk", json!({ "permission": "account:manage" }));
    let refused = call(&core, "desk", "account.status", scope()).unwrap_err();
    assert_eq!(serde_json::to_value(refused.code).unwrap(), "unsupported");
}
