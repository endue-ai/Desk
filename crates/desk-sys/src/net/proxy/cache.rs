//! PAC files by URL: fetched directly (never through a proxy, and not under a plugin's allowlist,
//! since the URL is the person's setting), at most 1 MiB within 10 s, and kept for 5 minutes,
//! failures included, so a broken PAC server is not asked on every connection.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use ureq::tls::{RootCerts, TlsConfig};
use url::Url;

use super::Route;
use super::pac::{Failure, Pac};
use crate::{Error, ErrorCode};

const KEEP: Duration = Duration::from_secs(5 * 60);
const MAX_PAC_BYTES: u64 = 1024 * 1024;
const LOAD_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub(super) struct Pacs {
    entries: Mutex<HashMap<String, Entry>>,
}

struct Entry {
    loaded: Instant,
    /// None: it failed to load, or ran into the runtime limits.
    pac: Option<Arc<Pac>>,
}

impl Pacs {
    /// The route the PAC file at `pac_url` gives `url`, or None when the file cannot be loaded or
    /// gives no route.
    pub(super) fn route(&self, pac_url: &str, url: &Url) -> Option<Route> {
        let pac = self.get(pac_url)?;
        match pac.evaluate(url.as_str()) {
            Ok(route) => Some(route),
            Err(Failure::Script(_)) => None,
            Err(Failure::Limits(_)) => {
                self.lock().insert(
                    pac_url.to_owned(),
                    Entry {
                        loaded: Instant::now(),
                        pac: None,
                    },
                );
                None
            }
        }
    }

    fn get(&self, pac_url: &str) -> Option<Arc<Pac>> {
        let mut entries = self.lock();
        if let Some(entry) = entries.get(pac_url)
            && entry.loaded.elapsed() < KEEP
        {
            return entry.pac.clone();
        }
        // Loading holds the lock: routes waiting for the same file wait for this one download.
        let pac = load(pac_url)
            .and_then(|script| Pac::new(&script))
            .ok()
            .map(Arc::new);
        entries.insert(
            pac_url.to_owned(),
            Entry {
                loaded: Instant::now(),
                pac: pac.clone(),
            },
        );
        pac
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Entry>> {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// The script at an http, https or file URL.
fn load(pac_url: &str) -> Result<String, Error> {
    let failed = |why: String| Error::new(ErrorCode::IoError, format!("PAC {pac_url}: {why}"));
    let url = Url::parse(pac_url).map_err(|err| failed(err.to_string()))?;
    let bytes = match url.scheme() {
        "http" | "https" => {
            let mut response = agent()
                .get(url.as_str())
                .call()
                .map_err(|err| failed(err.to_string()))?;
            if response.status() != 200 {
                return Err(failed(format!("status {}", response.status())));
            }
            response
                .body_mut()
                .with_config()
                .limit(MAX_PAC_BYTES)
                .read_to_vec()
                .map_err(|err| failed(err.to_string()))?
        }
        "file" => {
            let path = url
                .to_file_path()
                .map_err(|()| failed("not a local path".to_owned()))?;
            let bytes = std::fs::read(&path).map_err(|err| failed(err.to_string()))?;
            if bytes.len() as u64 > MAX_PAC_BYTES {
                return Err(failed("larger than 1 MiB".to_owned()));
            }
            bytes
        }
        other => return Err(failed(format!("{other} URLs are not read"))),
    };
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Direct, with the OS trust store; statuses are checked above.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .proxy(None)
            .http_status_as_error(false)
            .timeout_global(Some(LOAD_TIMEOUT))
            .tls_config(
                TlsConfig::builder()
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .build()
            .into()
    })
}
