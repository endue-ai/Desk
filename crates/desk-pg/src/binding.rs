//! SCRAM-SHA-256-PLUS's `tls-server-end-point` binding (RFC 5929): the server certificate hashed
//! with its signature's hash, SHA-256 for MD5 and SHA-1, as the server computes it. The hash is
//! read from the certificate's `signatureAlgorithm`; one the session cannot name has no binding,
//! and the sign-in goes on without channel binding.

use sha2::{Digest, Sha256, Sha384, Sha512};

/// The binding data for a DER certificate, or none when its algorithm has no hash to use.
pub(crate) fn end_point(cert: &[u8]) -> Option<Vec<u8>> {
    Some(match hash_of(cert)? {
        Hash::Sha256 => Sha256::digest(cert).to_vec(),
        Hash::Sha384 => Sha384::digest(cert).to_vec(),
        Hash::Sha512 => Sha512::digest(cert).to_vec(),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hash {
    Sha256,
    Sha384,
    Sha512,
}

/// `1.2.840.113549.1.1.*` (RSA) and `1.2.840.10045.4.*` (ECDSA), as DER content bytes.
const RSA: &[u8] = &[0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01];
const ECDSA: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04];
/// `2.16.840.1.101.3.4.2.*`: the SHA-2 hashes, which RSASSA-PSS names in its parameters.
const SHA2: &[u8] = &[0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02];

/// Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm AlgorithmIdentifier, signature }.
fn hash_of(cert: &[u8]) -> Option<Hash> {
    let (_, certificate, _) = tlv(cert, 0x30)?;
    let (_, _, rest) = tlv(certificate, 0x30)?;
    let (_, algorithm, _) = tlv(rest, 0x30)?;
    let (_, oid, params) = tlv(algorithm, 0x06)?;
    if let Some(last) = oid.strip_prefix(RSA) {
        return match last {
            // md5, sha1 and sha256 WithRSAEncryption
            [0x04] | [0x05] | [0x0b] => Some(Hash::Sha256),
            [0x0c] => Some(Hash::Sha384),
            [0x0d] => Some(Hash::Sha512),
            // RSASSA-PSS: the hash its parameters name, SHA-1 (so SHA-256) when they name none.
            [0x0a] => Some(pss_hash(params)),
            _ => None,
        };
    }
    match oid.strip_prefix(ECDSA)? {
        // ecdsa-with-SHA1, ecdsa-with-SHA256
        [0x01] | [0x03, 0x02] => Some(Hash::Sha256),
        [0x03, 0x03] => Some(Hash::Sha384),
        [0x03, 0x04] => Some(Hash::Sha512),
        _ => None,
    }
}

fn pss_hash(params: &[u8]) -> Hash {
    let named = |last: u8| {
        let mut oid = vec![0x06, SHA2.len() as u8 + 1];
        oid.extend_from_slice(SHA2);
        oid.push(last);
        params.windows(oid.len()).any(|w| w == oid.as_slice())
    };
    if named(0x02) {
        Hash::Sha384
    } else if named(0x03) {
        Hash::Sha512
    } else {
        Hash::Sha256
    }
}

/// One DER element of tag `tag` at the start of `input`: its tag, its content and what follows.
fn tlv(input: &[u8], tag: u8) -> Option<(u8, &[u8], &[u8])> {
    let (&found, rest) = input.split_first()?;
    if found != tag {
        return None;
    }
    let (&first, rest) = rest.split_first()?;
    let (len, rest) = if first < 0x80 {
        (usize::from(first), rest)
    } else {
        let count = usize::from(first & 0x7f);
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let len = rest[..count]
            .iter()
            .fold(0usize, |len, b| (len << 8) | usize::from(*b));
        (len, &rest[count..])
    };
    (rest.len() >= len).then(|| (found, &rest[..len], &rest[len..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A certificate's outer shape around a signature algorithm OID (and its parameters).
    fn cert(oid: &[u8], params: &[u8]) -> Vec<u8> {
        let wrap = |tag: u8, body: &[u8]| {
            let mut out = vec![tag, body.len() as u8];
            out.extend_from_slice(body);
            out
        };
        let mut algorithm = wrap(0x06, oid);
        algorithm.extend_from_slice(params);
        let mut body = wrap(0x30, &[0x02, 0x01, 0x01]);
        body.extend(wrap(0x30, &algorithm));
        body.extend(wrap(0x03, &[0x00, 0xaa]));
        wrap(0x30, &body)
    }

    fn rsa(last: u8) -> Vec<u8> {
        [RSA, &[last]].concat()
    }

    #[test]
    fn the_hash_follows_the_signature() {
        assert_eq!(hash_of(&cert(&rsa(0x05), &[])), Some(Hash::Sha256));
        assert_eq!(hash_of(&cert(&rsa(0x0b), &[])), Some(Hash::Sha256));
        assert_eq!(hash_of(&cert(&rsa(0x0c), &[])), Some(Hash::Sha384));
        assert_eq!(hash_of(&cert(&rsa(0x0d), &[])), Some(Hash::Sha512));
        let ecdsa = |tail: &[u8]| [ECDSA, tail].concat();
        assert_eq!(
            hash_of(&cert(&ecdsa(&[0x03, 0x02]), &[])),
            Some(Hash::Sha256)
        );
        assert_eq!(
            hash_of(&cert(&ecdsa(&[0x03, 0x03]), &[])),
            Some(Hash::Sha384)
        );
        assert_eq!(
            hash_of(&cert(&ecdsa(&[0x03, 0x04]), &[])),
            Some(Hash::Sha512)
        );
    }

    #[test]
    fn pss_names_its_hash_in_its_parameters() {
        let sha384 = [&[0x06, 0x09][..], SHA2, &[0x02]].concat();
        let params = [&[0x30, sha384.len() as u8][..], &sha384].concat();
        assert_eq!(hash_of(&cert(&rsa(0x0a), &params)), Some(Hash::Sha384));
        assert_eq!(hash_of(&cert(&rsa(0x0a), &[])), Some(Hash::Sha256));
    }

    #[test]
    fn an_unknown_algorithm_has_no_binding() {
        // Ed25519, 1.3.101.112
        assert_eq!(end_point(&cert(&[0x2b, 0x65, 0x70], &[])), None);
        assert_eq!(end_point(b"not a certificate"), None);
        let der = cert(&rsa(0x0b), &[]);
        assert_eq!(end_point(&der), Some(Sha256::digest(&der).to_vec()));
    }
}
