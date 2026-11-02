//! minisign verification in the Tauri updater's encoding: the public key and each signature are the
//! base64 of their minisign files. One key signs the index, the manifests and the artifacts (ADR 0054).

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use sha2::{Digest, Sha256};

/// Check `data` against `signature`, made by `pubkey`. With `version`, the signature's trusted
/// comment must name that version (`version:<v>`, as the Tauri CLI writes it), so an old artifact
/// cannot pass for a newer one. The comment is read only after the signature, which covers it, checks.
pub fn verify(
    data: &[u8],
    signature: &str,
    pubkey: &str,
    version: Option<&str>,
) -> Result<(), String> {
    let key = PublicKey::decode(&decoded(pubkey, "the updater key")?)
        .map_err(|e| format!("the updater key is not a minisign public key ({e})"))?;
    let signature = Signature::decode(&decoded(signature, "the signature")?)
        .map_err(|e| format!("the signature is not a minisign signature ({e})"))?;
    key.verify(data, &signature, true)
        .map_err(|_| "the signature does not match the updater key".to_owned())?;
    let Some(expected) = version else {
        return Ok(());
    };
    match signed_version(signature.trusted_comment()) {
        Some(signed) if same(signed, expected) => Ok(()),
        Some(signed) => Err(format!(
            "the artifact was signed for {signed}, not {expected}"
        )),
        None => Err(format!(
            "the signature does not name a version ({expected} expected)"
        )),
    }
}

/// The lowercase hex sha256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The `version` field of a trusted comment: tab-separated `key:value` pairs.
fn signed_version(comment: &str) -> Option<&str> {
    comment
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
}

fn same(signed: &str, expected: &str) -> bool {
    let parse = |v: &str| Version::parse(v.trim_start_matches('v'));
    match (parse(signed), parse(expected)) {
        (Ok(a), Ok(b)) => a == b,
        _ => signed == expected,
    }
}

fn decoded(text: &str, what: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(|_| format!("{what} is not base64"))?;
    String::from_utf8(bytes).map_err(|_| format!("{what} is not text"))
}
