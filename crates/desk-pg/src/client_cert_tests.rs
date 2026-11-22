//! Keys made at test time (ring's P-256), plain and encrypted with PBES2; no key is committed.

use pkcs8::der::pem::LineEnding;
use pkcs8::pkcs5::pbes2;
use pkcs8::{PrivateKeyInfoRef, SecretDocument};
use ring::rand::SystemRandom;
use ring::signature::{ECDSA_P256_SHA256_ASN1_SIGNING, EcdsaKeyPair};

use super::*;

fn plain_der() -> Vec<u8> {
    let random = SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_ASN1_SIGNING, &random).unwrap();
    pkcs8.as_ref().to_vec()
}

fn plain_pem(der: &[u8]) -> String {
    let doc = SecretDocument::try_from(der).unwrap();
    doc.to_pem("PRIVATE KEY", LineEnding::LF)
        .unwrap()
        .to_string()
}

fn encrypted_pem(der: &[u8], password: &str) -> String {
    let params =
        pbes2::Parameters::generate_pbkdf2_sha256_aes256cbc(2048, &[7; 16], [9; 16]).unwrap();
    let info = PrivateKeyInfoRef::try_from(der).unwrap();
    let doc = info.encrypt_with_params(params, password).unwrap();
    doc.to_pem("ENCRYPTED PRIVATE KEY", LineEnding::LF)
        .unwrap()
        .to_string()
}

#[test]
fn a_plain_key_loads_and_a_passphrase_is_not_needed() {
    let der = plain_der();
    let key = private_key(plain_pem(&der).as_bytes(), None).unwrap();
    assert_eq!(key.secret_der(), der.as_slice());
    assert!(private_key(plain_pem(&der).as_bytes(), Some("unused")).is_ok());
}

#[test]
fn an_encrypted_key_needs_its_passphrase_and_tells_a_wrong_one() {
    let der = plain_der();
    let pem = encrypted_pem(&der, "fixture-passphrase");
    assert_eq!(
        private_key(pem.as_bytes(), None).unwrap_err(),
        KeyError::NeedsPassword
    );
    assert_eq!(
        private_key(pem.as_bytes(), Some("")).unwrap_err(),
        KeyError::NeedsPassword
    );
    assert_eq!(
        private_key(pem.as_bytes(), Some("not it")).unwrap_err(),
        KeyError::WrongPassword
    );
    let key = private_key(pem.as_bytes(), Some("fixture-passphrase")).unwrap();
    assert_eq!(key.secret_der(), der.as_slice());
}

#[test]
fn the_key_is_read_first_then_the_certificate() {
    let der = plain_der();
    let pem = encrypted_pem(&der, "fixture-passphrase");
    let cert = b"no certificate here";
    let needs = ClientCert::from_pem(cert, pem.as_bytes(), None).unwrap_err();
    assert_eq!(needs, KeyError::NeedsPassword);
    let none = ClientCert::from_pem(cert, pem.as_bytes(), Some("fixture-passphrase")).unwrap_err();
    assert!(
        matches!(&none, KeyError::Invalid(why) if why.contains("no certificate")),
        "{none}"
    );
}

#[test]
fn a_pem_without_a_key_or_with_the_older_encryption_is_refused() {
    let missing = private_key(
        b"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
        None,
    );
    assert!(matches!(missing, Err(KeyError::Invalid(why)) if why.contains("no private key")));
    let older = concat!("-----BEGIN RSA ", "PRIVATE KEY-----\n");
    let older = format!(
        "{older}Proc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC,00\n\nMIIB\n-----END RSA PRIVATE KEY-----\n"
    );
    let refused = private_key(older.as_bytes(), Some("x"));
    assert!(matches!(refused, Err(KeyError::Invalid(why)) if why.contains("PKCS#8")));
}
