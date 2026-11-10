//! The buffer list, like Emacs's buffers (`packages/runtime/src/buffers.ts`): what is open, apart
//! from where it shows. Every plugin surface and every pane of the shell's own is a buffer; a
//! plugin may open more (a file each, say) and shows them in its own surface. The list keeps the
//! order buffers were used in, most recent first. It has no listeners: each change moves its
//! `revision` on, and the host tells whoever listens.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Buffer {
    pub id: String,
    pub name: String,
    /// The plugin that shows it.
    pub plugin: String,
    /// The file it holds, as a bridge path, when it holds one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Changed since it was opened or saved.
    pub modified: bool,
    /// The plugin's own surface rather than a buffer the plugin opened.
    pub surface: bool,
}

/// What an update changes: each field given.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BufferPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Buffers {
    by_id: BTreeMap<String, Buffer>,
    /// Ids, most recently used first.
    recent: Vec<String>,
    revision: u64,
}

impl Buffers {
    /// Add (or replace) a buffer. A new one goes last in the order of use until it is touched.
    pub fn add(&mut self, buffer: Buffer) -> Buffer {
        self.recent.retain(|id| id != &buffer.id);
        self.recent.push(buffer.id.clone());
        self.by_id.insert(buffer.id.clone(), buffer.clone());
        self.revision += 1;
        buffer
    }

    pub fn update(&mut self, id: &str, patch: BufferPatch) -> Option<Buffer> {
        let buffer = self.by_id.get_mut(id)?;
        if let Some(name) = patch.name {
            buffer.name = name;
        }
        if let Some(modified) = patch.modified {
            buffer.modified = modified;
        }
        if let Some(path) = patch.path {
            buffer.path = Some(path);
        }
        let next = buffer.clone();
        self.revision += 1;
        Some(next)
    }

    pub fn remove(&mut self, id: &str) -> Option<Buffer> {
        let buffer = self.by_id.remove(id)?;
        self.recent.retain(|other| other != id);
        self.revision += 1;
        Some(buffer)
    }

    /// Mark a buffer as the one in use now.
    pub fn touch(&mut self, id: &str) {
        if !self.by_id.contains_key(id) || self.recent.first().is_some_and(|first| first == id) {
            return;
        }
        self.recent.retain(|other| other != id);
        self.recent.insert(0, id.to_string());
        self.revision += 1;
    }

    pub fn get(&self, id: &str) -> Option<Buffer> {
        self.by_id.get(id).cloned()
    }

    /// Most recently used first.
    pub fn list(&self) -> Vec<Buffer> {
        self.recent.iter().filter_map(|id| self.get(id)).collect()
    }

    /// The buffer in use now: the most recently used.
    pub fn current(&self) -> Option<Buffer> {
        self.recent.first().and_then(|id| self.get(id))
    }

    pub fn by_path(&self, path: &str) -> Option<Buffer> {
        self.list()
            .into_iter()
            .find(|b| b.path.as_deref() == Some(path))
    }

    /// A plugin's buffers, most recently used first.
    pub fn of_plugin(&self, plugin: &str) -> Vec<Buffer> {
        self.list()
            .into_iter()
            .filter(|b| b.plugin == plugin)
            .collect()
    }

    /// The buffer `step` places from `from` in a stable order (by plugin, then name, then id),
    /// wrapping around, for next and previous; from none, the first (or the last going back).
    pub fn step(&self, from: Option<&str>, step: i64) -> Option<Buffer> {
        let mut order: Vec<&Buffer> = self.by_id.values().collect();
        order.sort_by(|a, b| {
            locale_compare(&a.plugin, &b.plugin)
                .then_with(|| locale_compare(&a.name, &b.name))
                .then_with(|| locale_compare(&a.id, &b.id))
        });
        let n = order.len() as i64;
        if n == 0 {
            return None;
        }
        let at = from.and_then(|id| order.iter().position(|b| b.id == id));
        let index = match at {
            None if step > 0 => 0,
            None => n - 1,
            Some(at) => at as i64 + step,
        };
        let i = usize::try_from(index.rem_euclid(n)).unwrap_or(0);
        Some(order[i].clone())
    }

    /// How many changes it has had: an add, an update, a remove or a touch each move it on.
    pub fn revision(&self) -> u64 {
        self.revision
    }
}

/// Names ordered as the runtime's `localeCompare` orders plain names: letters alike whatever
/// their case first, then lower case before upper.
fn locale_compare(a: &str, b: &str) -> Ordering {
    let folded = |s: &str| s.to_lowercase();
    folded(a).cmp(&folded(b)).then_with(|| {
        let swapped = |s: &str| -> String {
            s.chars()
                .map(|c| {
                    if c.is_lowercase() {
                        c.to_uppercase().next().unwrap_or(c)
                    } else {
                        c.to_lowercase().next().unwrap_or(c)
                    }
                })
                .collect()
        };
        swapped(a).cmp(&swapped(b))
    })
}

/// The last part of a bridge path: `~/notes/a.md` gives `a.md`.
pub fn base_name(path: &str) -> &str {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rsplit_once('/') {
        Some((_, last)) if !last.is_empty() => last,
        _ => trimmed,
    }
}
