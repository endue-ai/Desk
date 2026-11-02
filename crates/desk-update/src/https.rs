//! The release origin over HTTPS (feature `https`): ureq with rustls and the platform's roots, the
//! client desk-sys's `net` uses. A request names nothing about the desk: no cookies, and one
//! user agent for every desk. Connecting and each read are bounded, so a check always ends; a
//! download has no overall limit, since builds are large and links are slow.

use std::io::Read;
use std::time::Duration;

use ureq::Agent;

use crate::ports::Transport;

/// The most a document (an index, a manifest, a signature) may take.
pub const MAX_DOCUMENT: u64 = 4 * 1024 * 1024;
/// The most an artifact may take.
pub const MAX_ARTIFACT: u64 = 1024 * 1024 * 1024;
/// The user agent of every desk.
pub const USER_AGENT: &str = "endue-desk-updater";

pub struct Https {
    agent: Agent,
}

impl Https {
    /// A client for `https://` origins; with `allow_http`, `http://` too (a local origin while
    /// developing).
    pub fn new(allow_http: bool) -> Self {
        let config = Agent::config_builder()
            .https_only(!allow_http)
            .user_agent(USER_AGENT)
            .timeout_connect(Some(Duration::from_secs(15)))
            .timeout_send_request(Some(Duration::from_secs(30)))
            .timeout_per_read(Some(Duration::from_secs(60)))
            .max_redirects(5)
            .build();
        Self {
            agent: Agent::new_with_config(config),
        }
    }

    fn open(&self, url: &str) -> Result<ureq::http::Response<ureq::Body>, String> {
        self.agent.get(url).call().map_err(|e| match e {
            ureq::Error::StatusCode(code) => format!("{url} answered {code}"),
            other => format!("{url}: {other}"),
        })
    }
}

impl Transport for Https {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        let mut response = self.open(url)?;
        response
            .body_mut()
            .with_config()
            .limit(MAX_DOCUMENT)
            .read_to_vec()
            .map_err(|e| format!("{url}: {e}"))
    }

    fn download(
        &self,
        url: &str,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<Vec<u8>, String> {
        let mut response = self.open(url)?;
        let total = response.body().content_length();
        let mut reader = response
            .body_mut()
            .with_config()
            .limit(MAX_ARTIFACT)
            .reader();
        let mut bytes = Vec::with_capacity(total.unwrap_or(0).min(MAX_ARTIFACT) as usize);
        let mut chunk = vec![0u8; 256 * 1024];
        loop {
            let read = reader.read(&mut chunk).map_err(|e| format!("{url}: {e}"))?;
            if read == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..read]);
            progress(bytes.len() as u64, total);
        }
        Ok(bytes)
    }
}
