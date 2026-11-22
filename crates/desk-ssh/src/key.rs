//! A key file read and decoded before anything connects: OpenSSH, PEM (PKCS#1, SEC1) or PKCS#8,
//! encrypted or not. Its content never leaves this module but as the decoded key; no message
//! quotes it.

use std::io::Read;
use std::path::Path;

use russh::keys::{Error as KeyError, PrivateKey, decode_secret_key};

use crate::plan::{Failure, MAX_KEY_FILE, Passphrase, Stage, Which};

/// The key at `path`, decrypted with `passphrase` when it is encrypted.
pub(crate) fn load(
    which: Which,
    user: &str,
    path: &Path,
    passphrase: Option<&str>,
) -> Result<PrivateKey, Failure> {
    let shown = path.display();
    let fail = |why: String| {
        let message = format!("Key file of {user} on {}: {why}", which.words());
        Failure::new(which, Stage::Auth, message)
    };
    let file =
        std::fs::File::open(path).map_err(|e| fail(format!("{shown} cannot be read ({e})")))?;
    let mut text = String::new();
    file.take(MAX_KEY_FILE + 1)
        .read_to_string(&mut text)
        .map_err(|_| fail(format!("{shown} is not a text key file")))?;
    if text.len() as u64 > MAX_KEY_FILE {
        return Err(fail(format!("{shown} is larger than a key file (64 KiB)")));
    }
    let not_a_key = || fail(format!("{shown} holds no SSH private key the desk reads"));
    // An unencrypted key needs no passphrase; one given anyway is not used.
    match decode_secret_key(&text, None) {
        Ok(key) => return Ok(key),
        Err(KeyError::KeyIsEncrypted) => {}
        Err(_) if text.contains("ENCRYPTED") => {}
        Err(KeyError::UnsupportedKeyType {
            key_type_string, ..
        }) => {
            let why = format!("{shown} is a {key_type_string} key, which the desk does not take");
            return Err(fail(why));
        }
        Err(_) => return Err(not_a_key()),
    }
    let Some(passphrase) = passphrase else {
        let mut failure = fail(format!(
            "{shown} is encrypted and its passphrase was not given"
        ));
        failure.passphrase = Some(Passphrase::Needed);
        return Err(failure);
    };
    decode_secret_key(&text, Some(passphrase)).map_err(|_| {
        let mut failure = fail(format!("the passphrase does not decrypt {shown}"));
        failure.passphrase = Some(Passphrase::Wrong);
        failure
    })
}
