//! rustls for PostgreSQL's TLS modes, with ring as the provider as in desk-sys. `verify-full`
//! checks the chain and the host name, `verify-ca` the chain only, against the given authorities or
//! the OS's trust store; `require` and `prefer` encrypt without checking who answers, unless
//! authorities are given, when `require` checks the chain as libpq does. A client certificate, when
//! given, answers the server's CertificateRequest in every mode.

use std::sync::Arc;

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::sign::SingleCertAndKey;
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
};

use crate::client_cert::ClientCert;
use crate::config::TlsMode;

/// The client configuration for `mode`, trusting `ca` (PEM) or the OS's store, presenting
/// `client` when the server asks for a certificate.
pub(crate) fn config(
    mode: TlsMode,
    ca: Option<&[u8]>,
    client: Option<&ClientCert>,
) -> Result<Arc<ClientConfig>, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?;
    let checked = |name: bool| -> Result<Arc<dyn ServerCertVerifier>, String> {
        let chain: Arc<dyn ServerCertVerifier> = match ca {
            Some(pem) => WebPkiServerVerifier::builder_with_provider(roots(pem)?, provider.clone())
                .build()
                .map_err(|e| e.to_string())?,
            None => Arc::new(
                rustls_platform_verifier::Verifier::new(provider.clone())
                    .map_err(|e| e.to_string())?,
            ),
        };
        Ok(if name {
            chain
        } else {
            Arc::new(ChainOnly(chain))
        })
    };
    let verifier: Arc<dyn ServerCertVerifier> = match (mode, ca) {
        (TlsMode::Disable, _) => return Err("disable has no TLS".to_owned()),
        (TlsMode::Prefer, _) | (TlsMode::Require, None) => {
            Arc::new(Unchecked(provider.signature_verification_algorithms))
        }
        (TlsMode::Require | TlsMode::VerifyCa, _) => checked(false)?,
        (TlsMode::VerifyFull, _) => checked(true)?,
    };
    let builder = builder
        .dangerous()
        .with_custom_certificate_verifier(verifier);
    let config = match client {
        Some(client) => {
            builder.with_client_cert_resolver(Arc::new(SingleCertAndKey::from(client.0.clone())))
        }
        None => builder.with_no_client_auth(),
    };
    Ok(Arc::new(config))
}

/// The authorities in a PEM text; none at all is an error.
fn roots(pem: &[u8]) -> Result<Arc<RootCertStore>, String> {
    let mut roots = RootCertStore::empty();
    for cert in CertificateDer::pem_slice_iter(pem) {
        let cert = cert.map_err(|e| format!("the authorities' PEM: {e}"))?;
        roots
            .add(cert)
            .map_err(|e| format!("the authorities' PEM: {e}"))?;
    }
    if roots.is_empty() {
        return Err("the authorities' PEM holds no certificate".to_owned());
    }
    Ok(Arc::new(roots))
}

/// The name the server's certificate is checked against (and sent as SNI for a host name).
pub(crate) fn server_name(host: &str) -> Result<ServerName<'static>, String> {
    ServerName::try_from(host.to_owned()).map_err(|e| format!("{host}: {e}"))
}

/// `verify-ca`: the chain must lead to a trusted authority; the host name is not checked.
#[derive(Debug)]
struct ChainOnly(Arc<dyn ServerCertVerifier>);

impl ServerCertVerifier for ChainOnly {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        match self
            .0
            .verify_server_cert(end_entity, intermediates, server_name, ocsp, now)
        {
            Err(rustls::Error::InvalidCertificate(
                CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. },
            )) => Ok(ServerCertVerified::assertion()),
            other => other,
        }
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.0.verify_tls12_signature(message, cert, dss)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.0.verify_tls13_signature(message, cert, dss)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_verify_schemes()
    }
}

/// `require` and `prefer`: encrypted, the handshake's signatures checked, the certificate not.
#[derive(Debug)]
struct Unchecked(WebPkiSupportedAlgorithms);

impl ServerCertVerifier for Unchecked {
    fn verify_server_cert(
        &self,
        _: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.0)
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.0)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mode_but_disable_has_a_configuration() {
        for mode in [TlsMode::Prefer, TlsMode::Require] {
            assert!(config(mode, None, None).is_ok(), "{mode:?}");
        }
        assert!(config(TlsMode::Disable, None, None).is_err());
    }

    #[test]
    fn authorities_must_hold_a_certificate() {
        let error = config(TlsMode::VerifyFull, Some(b"no PEM here"), None).unwrap_err();
        assert!(error.contains("no certificate"), "{error}");
    }

    #[test]
    fn host_names_and_addresses_are_server_names() {
        assert!(server_name("db.example.com").is_ok());
        assert!(server_name("127.0.0.1").is_ok());
        assert!(server_name("not a name").is_err());
    }
}
