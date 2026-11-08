//! PKCE (RFC 7636) for the device flow: a fresh verifier of 32 random bytes in base64url (43
//! characters) per sign-in, and its S256 challenge, base64url(SHA-256(verifier)). The platform
//! requires S256 on `/api/v1/auth/device/start` and checks the verifier on every poll.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use sha2::{Digest, Sha256};

pub(super) struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    /// A new pair, or `None` when the system has no randomness to give.
    pub fn new() -> Option<Self> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).ok()?;
        Some(Self::from_bytes(&bytes))
    }

    fn from_bytes(bytes: &[u8]) -> Self {
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        let challenge = challenge_of(&verifier);
        Self {
            verifier,
            challenge,
        }
    }
}

/// The S256 challenge of `verifier`.
pub(super) fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_challenge_is_rfc_7636_appendix_b() {
        let bytes = [
            116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212,
            37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
        ];
        let pkce = Pkce::from_bytes(&bytes);
        assert_eq!(pkce.verifier, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn every_sign_in_gets_its_own_verifier() {
        let (a, b) = (Pkce::new().unwrap(), Pkce::new().unwrap());
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.verifier.len(), 43);
        assert_eq!(a.challenge.len(), 43);
    }
}
