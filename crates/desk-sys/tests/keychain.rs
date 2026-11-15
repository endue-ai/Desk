//! desk-sys keychain (feature `keychain`): the fake's rules, which the OS keychain follows too. No
//! test touches the person's keychain: `os()` is only named.

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
    assert_eq!(SERVICE, "ai.endue.desk");
    // Named, never called: a test must not reach the person's keychain.
    let _os: fn(&str) -> Result<OsKeychain, desk_sys::Error> = desk_sys::keychain::os;
}
