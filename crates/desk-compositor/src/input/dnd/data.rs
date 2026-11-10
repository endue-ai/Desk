//! Desk data as the broker reads it from a surface (ADR 0119, `packages/runtime/src/dnd/data.ts`): a
//! drag whose items, effects or image do not hold is refused whole. Paths are absolute bridge paths
//! without `..` or NUL; a URI is not script; JSON carries a lowercase kind; everything is bounded.
//! Then the plain-text fallback, the offered types and what the compositor draws.

use desk_surface::generated::{
    SurfaceDragImage, SurfaceDragItem, SurfaceDragPath, SurfaceDragPaths, SurfaceDragPlainText,
    SurfaceDropAnswer, SurfaceDropEffect,
};

/// Every effect, in the order a drag allows them by default.
pub const EFFECTS: [SurfaceDropEffect; 3] = [
    SurfaceDropEffect::Copy,
    SurfaceDropEffect::Move,
    SurfaceDropEffect::Link,
];
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_ITEMS: usize = 16;
const MAX_PATHS: usize = 10_000;
const MAX_IMAGE: usize = 512 * 1024;

/// A bridge path a drop may name: absolute (`/`, `~`, `C:/`), no NUL, no `..` segment.
pub fn path_holds(path: &str) -> bool {
    let bytes = path.as_bytes();
    let absolute = path.starts_with('/')
        || path == "~"
        || path.starts_with("~/")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/');
    absolute && path.len() <= 4096 && !path.contains('\0') && !path.split('/').any(|s| s == "..")
}

/// A URI with a scheme that is not script.
fn uri_holds(uri: &str) -> bool {
    let trimmed = uri.trim_start();
    let Some((scheme, _)) = trimmed.split_once(':') else {
        return false;
    };
    let lower = scheme.to_ascii_lowercase();
    let scheme_ok = scheme
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic())
        && scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    uri.len() <= 8192 && scheme_ok && lower != "javascript" && lower != "vbscript"
}

/// A JSON kind: lowercase segments, `db/rows`, `docker/container`.
fn kind_holds(kind: &str) -> bool {
    let segment = |s: &str| {
        let mut chars = s.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            && chars.all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
            })
    };
    !kind.is_empty() && kind.len() <= 128 && kind.split('/').all(segment)
}

fn item_holds(item: &SurfaceDragItem) -> bool {
    match item {
        SurfaceDragItem::SurfaceDragPaths(p) => {
            !p.paths.is_empty()
                && p.paths.len() <= MAX_PATHS
                && p.paths.iter().all(|e| path_holds(&e.path))
        }
        SurfaceDragItem::SurfaceDragText(t) => t.text.len() <= MAX_BYTES,
        SurfaceDragItem::SurfaceDragPlainText(t) => t.text.len() <= MAX_BYTES,
        SurfaceDragItem::SurfaceDragUri(u) => {
            uri_holds(&u.uri) && u.title.as_ref().is_none_or(|t| t.chars().count() <= 1024)
        }
        SurfaceDragItem::SurfaceDragJson(j) => kind_holds(&j.kind),
    }
}

/// The type an item offers: `desk/json` carries its kind.
pub fn type_of(item: &SurfaceDragItem) -> String {
    match item {
        SurfaceDragItem::SurfaceDragPaths(_) => "desk/paths".into(),
        SurfaceDragItem::SurfaceDragText(_) => "desk/text".into(),
        SurfaceDragItem::SurfaceDragUri(_) => "desk/uri".into(),
        SurfaceDragItem::SurfaceDragJson(j) => format!("desk/json:{}", j.kind),
        SurfaceDragItem::SurfaceDragPlainText(_) => "text/plain".into(),
    }
}

/// The items of a drag with the plain-text fallback, or `None` when one does not hold, a type
/// repeats or they are too big.
pub fn read_items(items: &[SurfaceDragItem]) -> Option<Vec<SurfaceDragItem>> {
    if items.is_empty() || items.len() > MAX_ITEMS || !items.iter().all(item_holds) {
        return None;
    }
    let types: Vec<String> = items.iter().map(type_of).collect();
    if (1..types.len()).any(|i| types[..i].contains(&types[i])) {
        return None;
    }
    let size = serde_json::to_string(items).ok()?.len();
    (size <= MAX_BYTES).then(|| with_fallback(items.to_vec()))
}

/// The plain text a drag offers when its source gave none: text, a URI, the paths, the JSON.
pub fn with_fallback(mut items: Vec<SurfaceDragItem>) -> Vec<SurfaceDragItem> {
    if items
        .iter()
        .any(|i| matches!(i, SurfaceDragItem::SurfaceDragPlainText(_)))
    {
        return items;
    }
    let find = |pick: fn(&SurfaceDragItem) -> Option<String>| items.iter().find_map(pick);
    let fallback = find(|i| match i {
        SurfaceDragItem::SurfaceDragText(t) => Some(t.text.clone()),
        _ => None,
    })
    .or_else(|| {
        find(|i| match i {
            SurfaceDragItem::SurfaceDragUri(u) => Some(u.uri.clone()),
            _ => None,
        })
    })
    .or_else(|| {
        find(|i| match i {
            SurfaceDragItem::SurfaceDragPaths(p) => Some(
                p.paths
                    .iter()
                    .map(|e| e.path.as_str())
                    .collect::<Vec<_>>()
                    .join("\n"),
            ),
            _ => None,
        })
    })
    .or_else(|| {
        find(|i| match i {
            SurfaceDragItem::SurfaceDragJson(j) => serde_json::to_string_pretty(&j.value).ok(),
            _ => None,
        })
    });
    if let Some(text) = fallback {
        items.push(SurfaceDragItem::SurfaceDragPlainText(
            SurfaceDragPlainText {
                r#type: Default::default(),
                text,
            },
        ));
    }
    items
}

/// The paths an OS drag carries, as desk data.
pub fn paths_item(paths: &[String]) -> SurfaceDragItem {
    SurfaceDragItem::SurfaceDragPaths(SurfaceDragPaths {
        r#type: Default::default(),
        paths: paths
            .iter()
            .map(|path| SurfaceDragPath {
                path: path.clone(),
                kind: None,
            })
            .collect(),
    })
}

/// The effects a source allows, each once, in the default order; `None` when empty or repeated.
pub fn read_effects(effects: &[SurfaceDropEffect]) -> Option<Vec<SurfaceDropEffect>> {
    let kept: Vec<SurfaceDropEffect> = EFFECTS
        .iter()
        .copied()
        .filter(|e| effects.contains(e))
        .collect();
    (!effects.is_empty() && kept.len() == effects.len()).then_some(kept)
}

/// An answer the source allows, else none.
pub fn read_answer(answer: SurfaceDropAnswer, allowed: &[SurfaceDropEffect]) -> SurfaceDropAnswer {
    match effect_of(answer) {
        Some(effect) if allowed.contains(&effect) => answer,
        _ => SurfaceDropAnswer::None,
    }
}

pub fn effect_of(answer: SurfaceDropAnswer) -> Option<SurfaceDropEffect> {
    match answer {
        SurfaceDropAnswer::Copy => Some(SurfaceDropEffect::Copy),
        SurfaceDropAnswer::Move => Some(SurfaceDropEffect::Move),
        SurfaceDropAnswer::Link => Some(SurfaceDropEffect::Link),
        SurfaceDropAnswer::None => None,
    }
}

pub fn answer_of(effect: SurfaceDropEffect) -> SurfaceDropAnswer {
    match effect {
        SurfaceDropEffect::Copy => SurfaceDropAnswer::Copy,
        SurfaceDropEffect::Move => SurfaceDropAnswer::Move,
        SurfaceDropEffect::Link => SurfaceDropAnswer::Link,
    }
}

/// Whether an accepted pattern takes an offered type: `desk/json` takes every kind.
fn takes(pattern: &str, offered: &str) -> bool {
    pattern == offered || (pattern == "desk/json" && offered.starts_with("desk/json:"))
}

/// The offered types `accept` takes, in the drag's order.
pub fn taken(accept: &[String], types: &[String]) -> Vec<String> {
    types
        .iter()
        .filter(|t| accept.iter().any(|p| takes(p, t)))
        .cloned()
        .collect()
}

/// What the compositor draws under the pointer: the source's label and image when they hold, else
/// a name for the items (a file's name, the text's first line, the URI, the kind) and their count.
#[derive(Clone, Debug, PartialEq)]
pub struct DragLook {
    pub label: String,
    pub detail: Option<String>,
    /// A `data:image/(png|jpeg|gif|webp);base64,` URL of 512 KiB at most.
    pub src: Option<String>,
    pub count: usize,
}

fn image_holds(src: &str) -> bool {
    let Some(rest) = src.strip_prefix("data:image/") else {
        return false;
    };
    let Some((kind, data)) = rest.split_once(";base64,") else {
        return false;
    };
    src.len() <= MAX_IMAGE
        && matches!(kind, "png" | "jpeg" | "gif" | "webp")
        && !data.is_empty()
        && data
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

fn short(text: &str, most: usize) -> Option<String> {
    (text.chars().count() <= most && !text.is_empty()).then(|| text.to_owned())
}

/// The look of a drag of `items` with the source's `image`.
pub fn look_of(items: &[SurfaceDragItem], image: Option<&SurfaceDragImage>) -> DragLook {
    let count = match items.first() {
        Some(SurfaceDragItem::SurfaceDragPaths(p)) => p.paths.len(),
        _ => 1,
    };
    let given_label = image
        .and_then(|i| i.label.as_deref())
        .and_then(|l| short(l, 200));
    let detail = image
        .and_then(|i| i.detail.as_deref())
        .and_then(|d| short(d, 200));
    let src = image.and_then(|i| i.src.clone()).filter(|s| image_holds(s));
    let label = given_label.unwrap_or_else(|| {
        let named = match items.first() {
            Some(SurfaceDragItem::SurfaceDragPaths(p)) => {
                let path = p.paths.first().map_or("", |e| e.path.as_str());
                let name = path.trim_end_matches('/').rsplit('/').next().unwrap_or("");
                if name.is_empty() { path } else { name }.to_owned()
            }
            Some(SurfaceDragItem::SurfaceDragUri(u)) => u.title.clone().unwrap_or(u.uri.clone()),
            Some(SurfaceDragItem::SurfaceDragJson(j)) => j.kind.clone(),
            Some(SurfaceDragItem::SurfaceDragText(t)) => first_line(&t.text),
            Some(SurfaceDragItem::SurfaceDragPlainText(t)) => first_line(&t.text),
            None => String::new(),
        };
        if named.chars().count() > 60 {
            format!("{}…", named.chars().take(59).collect::<String>())
        } else {
            named
        }
    });
    DragLook {
        label,
        detail,
        src,
        count,
    }
}

fn first_line(text: &str) -> String {
    text.trim().lines().next().unwrap_or("").to_owned()
}
