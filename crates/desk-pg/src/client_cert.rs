//! The client certificate a session presents when the server asks for one (libpq's `sslcert` and
//! `sslkey`, ADR 0331): a PEM chain and its private key, decoded and checked against each other
//! before anything connects. A key encrypted as PKCS#8 with PBES2 is decrypted with its passphrase,
//! which is used once and dropped; the key is then held for the session and its cancel requests.

use std::fmt;
use std::sync::Arc;

use pkcs8::EncryptedPrivateKeyInfoRef;
use pkcs8::der::pem;
use rustls::crypto::CryptoProvider;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::sign::CertifiedKey;

// The markers are joined from parts so a secret scanner does not read them as a key.
const ENCRYPTED_BEGIN: &str = concat!("-----BEGIN ", "ENCRYPTED PRIVATE KEY-----");
const ENCRYPTED_END: &str = concat!("-----END ", "ENCRYPTED PRIVATE KEY-----");

/// Why a client certificate cannot be used. The first two are answered as `keyPassword`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyError {
    /// The key is encrypted and no passphrase was given.
    NeedsPassword,
    /// The passphrase does not decrypt the key.
    WrongPassword,
    /// The certificate or the key cannot be used; the sentence says which and why.
    Invalid(String),
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::NeedsPassword => {
                f.write_str("the client key is encrypted: its passphrase is needed")
            }
            KeyError::WrongPassword => {
                f.write_str("the passphrase does not decrypt the client key")
            }
            KeyError::Invalid(why) => f.write_str(why),
        }
    }
}

/// A certificate chain with the key that signs for it, ready for every connection of a session.
#[derive(Clone)]
pub struct ClientCert(pub(crate) Arc<CertifiedKey>);

impl fmt::Debug for ClientCert {
    /// Never prints the key.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ClientCert({} certificates)", self.0.cert.len())
    }
}

impl ClientCert {
    /// The chain in `cert` and the key in `key`, both PEM. The key is read first, so a missing or
    /// wrong passphrase is told before the certificate is looked at.
    pub fn from_pem(
        cert: &[u8],
        key: &[u8],
        password: Option<&str>,
    ) -> Result<ClientCert, KeyError> {
        let key = private_key(key, password)?;
        let mut chain = Vec::new();
        for item in CertificateDer::pem_slice_iter(cert) {
            chain.push(item.map_err(|e| invalid(format!("the client certificate's PEM: {e}")))?);
        }
        if chain.is_empty() {
            return Err(invalid("the client certificate's PEM holds no certificate"));
        }
        let provider = rustls::crypto::ring::default_provider();
        certified(chain, key, &provider).map(|key| ClientCert(Arc::new(key)))
    }
}

fn invalid(why: impl Into<String>) -> KeyError {
    KeyError::Invalid(why.into())
}

fn certified(
    chain: Vec<CertificateDer<'static>>,
    key: PrivateKeyDer<'static>,
    provider: &CryptoProvider,
) -> Result<CertifiedKey, KeyError> {
    CertifiedKey::from_der(chain, key, provider).map_err(|e| match e {
        rustls::Error::InconsistentKeys(_) => {
            invalid("the client key does not belong to the client certificate")
        }
        other => invalid(format!(
            "the client certificate and key cannot be used: {other}"
        )),
    })
}

/// The private key in a PEM text: plain (PKCS#8, PKCS#1, SEC1) or PKCS#8 encrypted with PBES2.
fn private_key(pem: &[u8], password: Option<&str>) -> Result<PrivateKeyDer<'static>, KeyError> {
    let text = String::from_utf8_lossy(pem);
    if text.contains("Proc-Type: 4,ENCRYPTED") {
        return Err(invalid(
            "the client key is encrypted the older per-file PEM way: re-encrypt it as PKCS#8 with PBES2 (AES), or keep it unencrypted",
        ));
    }
    let Some(block) = encrypted_block(&text) else {
        return PrivateKeyDer::from_pem_slice(pem)
            .map_err(|_| invalid("the client key's PEM holds no private key"));
    };
    let Some(password) = password.filter(|p| !p.is_empty()) else {
        return Err(KeyError::NeedsPassword);
    };
    let bad = |e: String| invalid(format!("the client key's encrypted PEM: {e}"));
    let (_, der) = pem::decode_vec(block.as_bytes()).map_err(|e| bad(e.to_string()))?;
    let info =
        EncryptedPrivateKeyInfoRef::try_from(der.as_slice()).map_err(|e| bad(e.to_string()))?;
    let decrypted = info.decrypt(password.as_bytes()).map_err(|e| match e {
        pkcs8::Error::EncryptedPrivateKey(
            pkcs8::pkcs5::Error::DecryptFailed,
        )
        | pkcs8::Error::Asn1(_) => KeyError::WrongPassword,
        other => invalid(format!(
            "the client key is encrypted in a way the desk does not decrypt ({other}): re-encrypt it as PKCS#8 with PBES2 (AES)"
        )),
    })?;
    Ok(PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
        decrypted.as_bytes().to_vec(),
    )))
}

/// The `ENCRYPTED PRIVATE KEY` block of a PEM text, its lines included.
fn encrypted_block(text: &str) -> Option<&str> {
    let start = text.find(ENCRYPTED_BEGIN)?;
    let end = text[start..].find(ENCRYPTED_END)? + start + ENCRYPTED_END.len();
    Some(&text[start..end])
}

#[cfg(test)]
#[path = "client_cert_tests.rs"]
mod tests;
