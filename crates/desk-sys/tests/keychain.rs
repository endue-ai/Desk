//! desk-sys keychain (feature `keychain`): the fake's rules, which the OS keychain follows too. No
//! test the suite runs touches the person's keychain; the one ignored test is run by hand.

use desk_sys::ErrorCode;
use desk_sys::keychain::fake::FakeKeychain;
use desk_sys::keychain::{Keychain, OsKeychain, SERVICE};

#[test]
fn the_fake_keychain_stores_reads_and_deletes() {
    let keychain = FakeKeychain::new();
    assert_eq!(keychain.get("endue-id").unwrap(), None);
    keychain.set("endue-id", "one").unwrap();
    keychain.set("endue-id", "two").unwrap();
    assert_eq!(keychain.get("endue-id").unwrap().as_deref(), Some("two"));
    assert_eq!(keychain.get("other").unwrap(), None);
    keychain.delete("endue-id").unwrap();
    assert_eq!(keychain.get("endue-id").unwrap(), None);
    // Deleting what is not kept is fine.
    keychain.delete("endue-id").unwrap();
    assert!(keychain.secrets().is_empty());

    let unavailable = FakeKeychain::unavailable();
    let err = unavailable.set("endue-id", "one").unwrap_err();
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert_eq!(
        unavailable.get("endue-id").unwrap_err().code,
        ErrorCode::Unsupported
    );
    assert_eq!(
        unavailable.delete("endue-id").unwrap_err().code,
        ErrorCode::Unsupported
    );
    assert!(unavailable.secrets().is_empty());
}

#[test]
fn the_os_keychain_is_named_for_the_desk() {
    assert_eq!(SERVICE, "ai.endue.desktop");
    // Named, never called: a test must not reach the person's keychain.
    let _os: fn(&str) -> Result<OsKeychain, desk_sys::Error> = desk_sys::keychain::os;
}

/// The person's own keychain, under a test service of its own that it deletes after: run by hand
/// with `cargo test -p desk-sys --features keychain --test keychain -- --ignored`.
#[test]
#[ignore = "reaches the OS keychain"]
fn the_os_keychain_round_trips() {
    let keychain = desk_sys::keychain::os("ai.endue.desktop.test").unwrap();
    let account = format!("round-trip-{}", std::process::id());
    assert_eq!(keychain.get(&account).unwrap(), None);
    keychain.set(&account, "one").unwrap();
    keychain.set(&account, "two").unwrap();
    assert_eq!(keychain.get(&account).unwrap().as_deref(), Some("two"));
    keychain.delete(&account).unwrap();
    assert_eq!(keychain.get(&account).unwrap(), None);
    keychain.delete(&account).unwrap();
}
