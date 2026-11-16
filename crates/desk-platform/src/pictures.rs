//! An agent's face as endue.ai shows it (ADR 0232): the still of the character that is on, else
//! the picture the person set, else the one endue.ai draws from the slug. The picture is read
//! without the token, from its own host alone, and only when it is an image of a size a page can
//! carry as a data: URL.

use std::collections::BTreeMap;
use std::time::Duration;

use desk_sys::net::{Method, Request, fetch};

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

    /// The picture at `url`: https only (http on the platform's own host, for one on this
    /// machine), no token, no host but the picture's own, an image of at most `MAX_PICTURE`.
    pub fn picture(&self, url: &str) -> Option<Picture> {
        let host = host_of(url)?;
        let own = host == self.host && self.base.starts_with("http://");
        if !url.starts_with("https://") && !own {
            return None;
        }
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
        let response = fetch(&request).ok().filter(|r| r.status == 200)?;
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
