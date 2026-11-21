//! rustls for PostgreSQL's TLS modes: `verify-full` checks the chain and the host name (rustls's
//! own check), `verify-ca` the chain only, `require` encrypts without checking who answers, as libpq
//! does without a root certificate. Ring is the provider, as in desk-sys.

use std::sync::Arc;

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
};
use rustls_pki_types::pem::PemObject;
use rustls_pki_types::{CertificateDer, ServerName, UnixTime};
use sha2::{Digest, Sha256};

use crate::conninfo::{ConnInfo, SslMode};

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// The client configuration for a connection's mode and trusted authorities.
pub fn config(info: &ConnInfo) -> Result<Arc<ClientConfig>, String> {
    let provider = provider();
    let builder = ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?;
    let config = match info.sslmode {
        SslMode::Prefer | SslMode::Require => builder
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(Unchecked(
                provider.signature_verification_algorithms,
            )))
            .with_no_client_auth(),
        SslMode::VerifyCa | SslMode::VerifyFull => {
            let pem = info.ca_pem.as_ref().ok_or(
                "verify-ca and verify-full need sslrootcert here; the core would use the OS store",
            )?;
            let mut roots = RootCertStore::empty();
            for cert in CertificateDer::pem_slice_iter(pem) {
                roots
                    .add(cert.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            }
            let roots = Arc::new(roots);
            if info.sslmode == SslMode::VerifyFull {
                builder.with_root_certificates(roots).with_no_client_auth()
            } else {
                let inner = WebPkiServerVerifier::builder_with_provider(roots, provider)
                    .build()
                    .map_err(|e| e.to_string())?;
                builder
                    .dangerous()
                    .with_custom_certificate_verifier(Arc::new(ChainOnly(inner)))
                    .with_no_client_auth()
            }
        }
        SslMode::Disable => return Err("disable has no TLS".to_owned()),
    };
    Ok(Arc::new(config))
}

pub fn server_name(host: &str) -> Result<ServerName<'static>, String> {
    ServerName::try_from(host.to_owned()).map_err(|e| e.to_string())
}

/// SCRAM's `tls-server-end-point` binding: a hash of the server's certificate (RFC 5929). SHA-256
/// fits certificates signed with SHA-1 or SHA-256, which the spike's certificate is; the core picks
/// the hash from the certificate's signature algorithm, as tokio-postgres-rustls does.
pub fn end_point(cert: &CertificateDer<'_>) -> Vec<u8> {
    Sha256::digest(cert.as_ref()).to_vec()
}

/// `verify-ca`: the chain must lead to a trusted authority; any host name is accepted.
#[derive(Debug)]
struct ChainOnly(Arc<WebPkiServerVerifier>);

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
