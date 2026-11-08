//! The desk's endue ID on the bridge (ADR 0089, ADR 0111): account.* signs in through a fake of the
//! platform's auth BFF, opens endue ID's page (the sign-up page for Create account, again when asked
//! again), keeps the session in a file only this user reads, tells holders of account:manage about
//! every change with the profile, and never lets a token cross the bridge.

#[path = "account_auth/fake_bff.rs"]
mod fake_bff;
mod support;

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_core::Core;
use desk_core::account::{Account, AccountOptions, NetIdClient, State};
use desk_sys::Error;
use desk_sys::shell::Opener;
use fake_bff::{Bff, Poll};
use serde_json::{Value, json};
use support::*;

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

fn account(bff: &Bff, home: &Path) -> Arc<Account> {
    let mut options = AccountOptions::new(bff.url(), bff.auth_url());
    options.file = Some(home.join("account.json"));
    options.interval_unit = Duration::from_millis(10);
    options.retry = vec![Duration::from_millis(5); 3];
    Account::open(options, NetIdClient)
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

/// The account once it is no longer signing in, or after five seconds.
fn settled(account: &Account) -> State {
    for _ in 0..1000 {
        let state = account.status().state;
        if !matches!(state, State::SigningIn(_)) {
            return state;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    account.status().state
}

#[test]
fn create_account_opens_the_sign_up_page_and_reports_the_profile_without_a_token() {
    let home = home("account-sign-up");
    let bff = Bff::start();
    bff.script().polls = [Poll::Pending, Poll::Approve].into();
    let account = account(&bff, &home);
    let opened = Opened::default();
    let core = core(&account, &home, &opened);
    let deliveries = core.events().subscribe_addressed();

    let params = json!({ "scope": { "permission": "account:manage" }, "screen": "sign-up" });
    let started = call(&core, "desk", "account.signIn", params).unwrap();
    assert_eq!(started["state"], "signing-in");
    assert_eq!(started["signIn"]["userCode"], "WDJB-MJHT");
    assert_eq!(started["signIn"]["screen"], "sign-up");
    let page = format!(
        "{}/device?user_code=WDJB-MJHT&prompt=create",
        bff.auth_url()
    );
    assert_eq!(started["signIn"]["verificationUriComplete"], page.as_str());
    assert_eq!(*opened.0.lock().unwrap(), [page]);

    assert_eq!(settled(&account), State::SignedIn);
    let status = call(&core, "desk", "account.status", scope()).unwrap();
    assert_eq!(status["state"], "signed-in");
    assert_eq!(status["profile"]["displayName"], "Ada Lovelace");
    assert_eq!(status["profile"]["email"], "ada@example.com");
    assert!(
        status["profile"]["avatarUrl"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    assert_eq!(status.get("problem"), None);

    // The state changes before its event goes out: wait for both events.
    let changed = [
        wait_for(&deliveries, "account.changed"),
        wait_for(&deliveries, "account.changed"),
    ];
    assert!(changed.iter().all(|d| d.is_for("desk")));
    let states: Vec<&Value> = changed.iter().map(|d| &d.data()["state"]).collect();
    assert_eq!(states, ["signing-in", "signed-in"]);
    assert_eq!(changed[1].data()["profile"]["displayName"], "Ada Lovelace");
    let file = fs::read_to_string(home.join("account.json")).unwrap();
    assert!(file.contains("access1") && file.contains("rt1"));
    for said in changed
        .iter()
        .map(|d| d.data().to_string())
        .chain([status.to_string()])
    {
        assert!(!said.contains("access1") && !said.contains("rt1"), "{said}");
    }
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
fn signing_in_again_opens_the_page_again_with_the_same_code() {
    let home = home("account-again");
    let bff = Bff::start();
    let account = account(&bff, &home);
    let opened = Opened::default();
    let core = core(&account, &home, &opened);

    let first = call(&core, "desk", "account.signIn", scope()).unwrap();
    let again = call(&core, "desk", "account.signIn", scope()).unwrap();
    assert_eq!(first["signIn"]["userCode"], again["signIn"]["userCode"]);
    assert_eq!(again["signIn"]["screen"], "sign-in");
    let page = format!("{}/device?user_code=WDJB-MJHT", bff.auth_url());
    assert_eq!(*opened.0.lock().unwrap(), [page.clone(), page]);
    assert_eq!(bff.seen("/api/v1/auth/device/start").len(), 1);
    call(&core, "desk", "account.signOut", scope()).unwrap();
}

#[test]
fn a_sign_in_that_cannot_start_answers_why() {
    let home = home("account-cannot-start");
    let bff = Bff::start();
    bff.script().start = [(503, "DEVICE_LOGIN_UNAVAILABLE"); 4].into();
    let account = account(&bff, &home);
    let opened = Opened::default();
    let core = core(&account, &home, &opened);
    let answer = call(&core, "desk", "account.signIn", scope()).unwrap();
    assert_eq!(answer["state"], "signed-out");
    assert_eq!(answer["reason"], "unavailable");
    assert!(answer["problem"].as_str().unwrap().contains("endue"));
    assert!(opened.0.lock().unwrap().is_empty());
}

#[test]
fn signing_out_revokes_the_session_and_only_holders_of_account_manage_may_ask() {
    let home = home("account-sign-out");
    let bff = Bff::start();
    bff.script().polls = [Poll::Approve].into();
    let account = account(&bff, &home);
    let core = core(&account, &home, &Opened::default());
    call(&core, "desk", "account.signIn", scope()).unwrap();
    assert_eq!(settled(&account), State::SignedIn);

    let refused = call(&core, "endue.mail", "account.signOut", scope()).unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );
    let out = call(&core, "desk", "account.signOut", scope()).unwrap();
    assert_eq!(out, json!({ "state": "signed-out" }));
    assert_eq!(bff.seen("/api/v1/auth/logout").len(), 1);
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

#[test]
fn the_hosts_come_from_the_environment_with_endue_s_as_defaults() {
    let none = AccountOptions::from_vars(|_| None);
    assert_eq!(none.platform_url, "https://platform.endue.ai");
    assert_eq!(none.auth_url, "https://auth.endue.ai/realms/endue");
    let dev = AccountOptions::from_vars(|name| {
        (name == "DESK_ENDUE_PLATFORM_URL").then(|| "https://platform.dev.endue.ai/".to_owned())
    });
    assert_eq!(dev.platform_url, "https://platform.dev.endue.ai");
    assert_eq!(dev.auth_url, "https://id-dev.endue.ai/realms/endue");
    let both = AccountOptions::from_vars(|name| match name {
        "DESK_ENDUE_PLATFORM_URL" => Some("http://127.0.0.1:8788".to_owned()),
        "DESK_ENDUE_AUTH_URL" => Some("http://127.0.0.1:8181/realms/endue".to_owned()),
        _ => None,
    });
    assert_eq!(both.platform_url, "http://127.0.0.1:8788");
    assert_eq!(both.auth_url, "http://127.0.0.1:8181/realms/endue");
}
