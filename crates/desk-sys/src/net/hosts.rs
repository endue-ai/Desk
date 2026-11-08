//! The host allowlist: bridge `HostPattern`s, matched the way desk-core `host_match` does.

use url::Url;

use crate::{Error, ErrorCode};

/// Whether `url`'s host matches one of `allowed_hosts`. A pattern is a host name, matched exactly, or
/// `*.` and a domain for any of its subdomains (not the domain itself), case-insensitive. A pattern
/// with a port matches only that port (80 or 443 when the URL names none); one without matches any.
pub fn host_allowed(allowed_hosts: &[String], url: &str) -> bool {
    Url::parse(url).is_ok_and(|url| allows(allowed_hosts, &url))
}

/// `permission_denied`, naming the host, unless `url` matches `allowed_hosts`. `requested` is the URL
/// the caller asked for, which a redirect may have led away from.
pub(super) fn check(allowed_hosts: &[String], url: &Url, requested: &str) -> Result<(), Error> {
    if allows(allowed_hosts, url) {
        return Ok(());
    }
    let host = url.host_str().unwrap_or_default();
    Err(Error::new(
        ErrorCode::PermissionDenied,
        format!("{host} is not an allowed host for {requested}"),
    ))
}

fn allows(allowed_hosts: &[String], url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let port = url.port_or_known_default();
    allowed_hosts
        .iter()
        .any(|pattern| matches(pattern, host, port))
}

fn matches(pattern: &str, host: &str, port: Option<u16>) -> bool {
    let (name, wanted) = match pattern.rsplit_once(':') {
        Some((name, wanted)) => match wanted.parse::<u16>() {
            Ok(wanted) => (name, Some(wanted)),
            Err(_) => return false,
        },
        None => (pattern, None),
    };
    if wanted.is_some() && wanted != port {
        return false;
    }
    let (name, host) = (name.to_ascii_lowercase(), host.to_ascii_lowercase());
    match name.strip_prefix("*.") {
        Some(domain) => host.ends_with(&format!(".{domain}")),
        None => name == host,
    }
}
