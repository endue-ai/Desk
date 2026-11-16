//! `endue://` links (ADR 0244). A link outlives the desk that made it, so its grammar is versioned
//! and closed: version `v1` knows three verbs, and anything else is refused whole, never partly run.
//!
//! ```text
//! endue://v1/open?path=<percent-encoded absolute path>   open a file or folder, as a double-click does
//! endue://v1/plugin/<plugin-id>[?surface=<surface-id>]   bring a plugin up
//! endue://v1/command/<command-id>                         run a command, once the person says yes
//! ```
//!
//! The scheme, version and verb are case-insensitive; ids are as the plugin spec writes them. `auth`
//! and `install` are reserved for the login callback and install links and refused until they exist.
//! An unknown version, verb or query key, a repeated key, a fragment, a user or port, a relative or
//! `..` path, a NUL and a link over 8 KiB are refused, each with a sentence the desk's notice shows.

use std::fmt;

mod text;

pub use text::{decode, encode};

/// The scheme every link has.
pub const SCHEME: &str = "endue";
/// The one version this grammar reads.
pub const VERSION: &str = "v1";
/// The longest link read.
pub const MAX_LEN: usize = 8 * 1024;
const MAX_PATH: usize = 4096;
/// Verbs a later version may give meaning to; refused now.
const RESERVED: [&str; 2] = ["auth", "install"];

/// What a link asks the desk to do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Link {
    /// Open a file or folder: an absolute path with forward slashes.
    Open { path: String },
    /// Bring a plugin up, at one of its surfaces if named.
    Plugin { id: String, surface: Option<String> },
    /// Run a command, without arguments.
    Command { id: String },
}

/// Why a link is not one the desk opens: a sentence for the person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused(pub String);

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Refused {}

fn refuse<T>(why: impl Into<String>) -> Result<T, Refused> {
    Err(Refused(why.into()))
}

/// Whether `arg` is meant as a link (`endue:` in any case), not a path.
pub fn is_link(arg: &str) -> bool {
    arg.get(..SCHEME.len() + 1)
        .is_some_and(|head| head.eq_ignore_ascii_case("endue:"))
}

/// A plugin or command id: lowercase dotted segments (`endue.notes`, `endue.notes.new`).
fn id_holds(id: &str) -> bool {
    let segment = |s: &str| {
        let mut chars = s.chars();
        chars.next().is_some_and(|c| c.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    };
    let parts: Vec<&str> = id.split('.').collect();
    id.len() <= 128 && parts.len() >= 2 && parts.iter().all(|s| segment(s))
}

/// A surface id: one lowercase segment (`main`, `side-panel`).
fn surface_holds(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= 64
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_'))
}

/// An absolute path as the bridge writes it: `/…` or `C:/…`, no NUL, no `..` segment.
fn path_of(raw: &str) -> Result<String, Refused> {
    let path = raw.replace('\\', "/");
    let bytes = path.as_bytes();
    let drive =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    if !(path.starts_with('/') || drive) {
        return refuse("A file link names an absolute path.");
    }
    if path.contains('\0') || path.len() > MAX_PATH || path.split('/').any(|s| s == "..") {
        return refuse("A file link's path is not one the desk opens.");
    }
    Ok(path)
}

/// The query's keys and values, decoded; a repeated or empty key is refused.
fn query(text: &str) -> Result<Vec<(String, String)>, Refused> {
    let mut pairs: Vec<(String, String)> = Vec::new();
    for pair in text.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let (key, value) = (decode(key)?, decode(value)?);
        if key.is_empty() || pairs.iter().any(|(k, _)| *k == key) {
            return refuse("A link names each of its parts once.");
        }
        pairs.push((key, value));
    }
    Ok(pairs)
}

/// Only the keys in `known`, each at most once: their values by key.
fn only<'a>(
    pairs: &'a [(String, String)],
    known: &[&str],
) -> Result<Vec<Option<&'a str>>, Refused> {
    if pairs.iter().any(|(k, _)| !known.contains(&k.as_str())) {
        return refuse("This link asks for something the desk does not know.");
    }
    let value = |name: &str| {
        pairs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    };
    Ok(known.iter().map(|name| value(name)).collect())
}

/// A character that changes how text around it reads without showing itself: bidirectional controls
/// and other invisible format characters (`U+202E` turns `gpj.exe` into `exe.jpg`).
pub(crate) fn hidden(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x061C | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064
        | 0x2066..=0x206F | 0xFEFF | 0xFFF9..=0xFFFB)
}

/// Read `text` as a link, or say why it is not one. No sentence repeats any of the link's text.
pub fn parse(text: &str) -> Result<Link, Refused> {
    if text.len() > MAX_LEN {
        return refuse("This link is too long to be one the desk opens.");
    }
    if text
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || hidden(c))
    {
        return refuse("This link has spaces or control characters in it.");
    }
    let Some((scheme, rest)) = text.split_once(':') else {
        return refuse("This is not an endue:// link.");
    };
    if !scheme.eq_ignore_ascii_case(SCHEME) {
        return refuse("This is not an endue:// link.");
    }
    let Some(rest) = rest.strip_prefix("//") else {
        return refuse("An endue link starts with endue://.");
    };
    if rest.contains('#') {
        return refuse("An endue link has no fragment.");
    }
    let (before, query_text) = rest.split_once('?').unwrap_or((rest, ""));
    let (version, path) = before.split_once('/').unwrap_or((before, ""));
    if version.contains(['@', ':']) {
        return refuse("An endue link names no user or port.");
    }
    if !version.eq_ignore_ascii_case(VERSION) {
        return refuse("This link is for another version of endue Desk; this one opens v1 links.");
    }
    let pairs = query(query_text)?;
    let mut parts = path.split('/');
    let verb = parts.next().unwrap_or("").to_ascii_lowercase();
    let rest: Vec<&str> = parts.collect();
    match (verb.as_str(), rest.as_slice()) {
        ("open", []) => match only(&pairs, &["path"])?.as_slice() {
            [Some(path)] => Ok(Link::Open {
                path: path_of(path)?,
            }),
            _ => refuse("A file link names its path (endue://v1/open?path=…)."),
        },
        ("plugin", [id]) => {
            let id = decode(id)?;
            if !id_holds(&id) {
                return refuse("This link does not name a plugin.");
            }
            let surface = only(&pairs, &["surface"])?[0];
            if surface.is_some_and(|s| !surface_holds(s)) {
                return refuse("This link does not name a surface of a plugin.");
            }
            Ok(Link::Plugin {
                id,
                surface: surface.map(str::to_owned),
            })
        }
        ("command", [id]) => {
            let id = decode(id)?;
            if !id_holds(&id) {
                return refuse("This link does not name a command.");
            }
            only(&pairs, &[])?;
            Ok(Link::Command { id })
        }
        (verb, _) if RESERVED.contains(&verb) => refuse(format!(
            "endue://v1/{verb} links are not opened by this version of endue Desk."
        )),
        ("open" | "plugin" | "command", _) => {
            refuse("This link's parts are not in the right order.")
        }
        _ => refuse("This link asks for something the desk does not do."),
    }
}

impl fmt::Display for Link {
    /// The canonical form: lowercase scheme, version and verb, the path percent-encoded.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Link::Open { path } => write!(f, "{SCHEME}://{VERSION}/open?path={}", encode(path)),
            Link::Plugin { id, surface: None } => write!(f, "{SCHEME}://{VERSION}/plugin/{id}"),
            Link::Plugin {
                id,
                surface: Some(s),
            } => {
                write!(f, "{SCHEME}://{VERSION}/plugin/{id}?surface={s}")
            }
            Link::Command { id } => write!(f, "{SCHEME}://{VERSION}/command/{id}"),
        }
    }
}
