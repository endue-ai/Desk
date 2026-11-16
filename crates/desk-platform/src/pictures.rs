//! An agent's face as endue.ai shows it (ADR 0232): the still of the character that is on, else
//! the picture the person set, else the one endue.ai draws from the slug. The picture is read
//! without the token, from its own host alone, and only when it is an image of a size a page can
//! carry as a data: URL. It is never read from an IP literal, a private name or a port but 443
//! (issue 352), save on the platform's own host, and the read stops once it passes `MAX_PICTURE`.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch_at_most};

use crate::Platform;
use crate::http::encode;
use crate::wire::Agent;

/// Where endue.ai draws the face of an agent that has no picture: DiceBear's robots.
pub const DRAWN_URL: &str = "https://api.dicebear.com/9.x/bottts-neutral/svg";
/// The largest picture kept.
pub const MAX_PICTURE: usize = 512 * 1024;
/// How long a picture may take.
pub const PICTURE_TIMEOUT: Duration = Duration::from_secs(10);
const KINDS: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
];

/// Which picture a face is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Face {
    Character,
    Photo,
    Drawn,
}

/// A picture read: its media type and its bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Picture {
    pub kind: String,
    pub bytes: Vec<u8>,
}

/// endue.ai's seed for a drawn face: the slug, then its djb2 hash over UTF-16 units in hex.
fn seed(slug: &str) -> String {
    let hash = slug.encode_utf16().fold(5381u32, |h, unit| {
        (h << 5).wrapping_add(h).wrapping_add(u32::from(unit))
    });
    format!("{slug}-{hash:x}")
}

/// The host of an absolute http(s) URL, lowercase and with its port; `None` with userinfo.
fn host_of(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    (!host.is_empty() && !host.contains('@')).then(|| host.to_ascii_lowercase())
}

/// Whether `host` (lowercase, with its port when it has one) is a public name on port 443: not an
/// IP literal, not `localhost` and not under a name only a local network answers.
fn public_host(host: &str) -> bool {
    if host.starts_with('[') {
        return false; // An IPv6 literal.
    }
    let (name, port) = match host.rsplit_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    if port.is_some_and(|p| p != "443") || name.parse::<std::net::Ipv4Addr>().is_ok() {
        return false;
    }
    let name = name.trim_end_matches('.');
    let local = ["localhost", "local", "internal", "home.arpa", "lan"];
    name.contains('.')
        && !local
            .iter()
            .any(|l| name == *l || name.ends_with(&format!(".{l}")))
}

impl Platform {
    /// Draw the faces of agents without a picture from `url` instead of DiceBear (tests).
    pub fn with_drawn(mut self, url: &str) -> Self {
        self.drawn = url.trim_end_matches('/').to_owned();
        self
    }

    /// Where `agent`'s face is, in endue.ai's order, and which picture it is.
    pub fn face_of(&self, agent: &Agent) -> (String, Face) {
        let set = |url: &Option<String>| {
            url.as_deref()
                .map(str::trim)
                .filter(|u| !u.is_empty())
                .map(str::to_owned)
        };
        if let Some(url) = set(&agent.character_image_url) {
            return (url, Face::Character);
        }
        if let Some(url) = set(&agent.avatar_url) {
            return (url, Face::Photo);
        }
        let drawn = format!("{}?seed={}", self.drawn, encode(&seed(&agent.slug)));
        (drawn, Face::Drawn)
    }

    /// Whether a picture may be read from `url`: https from a public name on port 443, or the
    /// platform's own host (http too when the platform is on this machine).
    pub fn may_read_picture(&self, url: &str) -> bool {
        let Some(host) = host_of(url) else {
            return false;
        };
        if host == self.host {
            return url.starts_with("https://") || self.base.starts_with("http://");
        }
        url.starts_with("https://") && public_host(&host)
    }

    /// The picture at `url`, when `may_read_picture` allows it: no token, no host but the
    /// picture's own, an image of at most `MAX_PICTURE`, its read stopped once it passes that.
    pub fn picture(&self, url: &str) -> Option<Picture> {
        if !self.may_read_picture(url) {
            return None;
        }
        let host = host_of(url)?;
        let request = Request {
            url: url.to_owned(),
            method: Method::Get,
            headers: BTreeMap::from([
                ("accept".to_owned(), "image/*".to_owned()),
                ("user-agent".to_owned(), "endue-desk".to_owned()),
            ]),
            body: None,
            timeout: Some(PICTURE_TIMEOUT.min(self.timeout)),
            allowed_hosts: vec![host],
        };
        let response = fetch_at_most(&request, MAX_PICTURE as u64)
            .ok()
            .filter(|r| r.status == 200)?;
        let kind = response
            .headers
            .get("content-type")?
            .split(';')
            .next()?
            .trim()
            .to_ascii_lowercase();
        let fits = !response.body.is_empty() && response.body.len() <= MAX_PICTURE;
        (KINDS.contains(&kind.as_str()) && fits).then_some(Picture {
            kind,
            bytes: response.body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_seed_is_endue_ais() {
        // `${name}-${hashSeed(name)}` as endue.ai's web answers it.
        assert_eq!(seed("miso"), "miso-7c9aa2bd");
        assert_eq!(seed("고양이"), "고양이-e8056ea");
        assert_eq!(seed(""), "-1505");
    }

    #[test]
    fn a_host_is_read_only_from_an_absolute_url_without_userinfo() {
        assert_eq!(
            host_of("https://CDN.endue.ai/a.png").as_deref(),
            Some("cdn.endue.ai")
        );
        assert_eq!(
            host_of("http://127.0.0.1:8080/a").as_deref(),
            Some("127.0.0.1:8080")
        );
        assert_eq!(host_of("https://user@evil.example/a.png"), None);
        assert_eq!(host_of("/media/a.png"), None);
        assert_eq!(host_of("file:///etc/passwd"), None);
    }
}
