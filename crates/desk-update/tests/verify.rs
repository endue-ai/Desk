//! minisign in the Tauri encoding: the key, the bytes, and the version an artifact was signed for.

mod support;

use desk_update::verify::verify;
use support::Key;

#[test]
fn accepts_bytes_signed_by_the_key() {
    let key = Key::new();
    let data = b"channels/stable/index.json";
    assert_eq!(
        verify(data, &key.sign(data, None), &key.public(), None),
        Ok(())
    );
    let artifact = b"endue Desk 0.2.0";
    let signed = key.sign(artifact, Some("0.2.0"));
    assert_eq!(
        verify(artifact, &signed, &key.public(), Some("0.2.0")),
        Ok(())
    );
    let tagged = key.sign(artifact, Some("v0.2.0"));
    assert_eq!(
        verify(artifact, &tagged, &key.public(), Some("0.2.0")),
        Ok(()),
        "v is not part of a version"
    );
}

#[test]
fn refuses_another_key_and_tampered_bytes() {
    let (key, other) = (Key::new(), Key::new());
    let data = b"endue Desk 0.2.0";
    let signature = key.sign(data, None);
    let wrong_key = verify(data, &signature, &other.public(), None).unwrap_err();
    assert!(wrong_key.contains("does not match"), "{wrong_key}");
    let tampered = verify(b"endue Desk 0.2.1", &signature, &key.public(), None).unwrap_err();
    assert!(tampered.contains("does not match"), "{tampered}");
    assert!(verify(data, "not base64!", &key.public(), None).is_err());
    assert!(verify(data, &signature, "", None).is_err());
}

#[test]
fn refuses_an_artifact_signed_for_another_version() {
    let key = Key::new();
    let artifact = b"endue Desk 0.1.0";
    let old = key.sign(artifact, Some("0.1.0"));
    let replayed = verify(artifact, &old, &key.public(), Some("0.2.0")).unwrap_err();
    assert!(
        replayed.contains("signed for 0.1.0, not 0.2.0"),
        "{replayed}"
    );
    let unnamed = key.sign(artifact, None);
    let missing = verify(artifact, &unnamed, &key.public(), Some("0.2.0")).unwrap_err();
    assert!(missing.contains("does not name a version"), "{missing}");
}
