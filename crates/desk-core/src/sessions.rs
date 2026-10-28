//! The session store: this desk's id, the brain session it continues and the recent transcript, in
//! one JSON file in the app's data folder (or in memory only).

use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::BuildHasher;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// How many lines of transcript are kept.
const KEEP: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    Person,
    Eris,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Said {
    pub speaker: Speaker,
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    desk_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(default)]
    transcript: Vec<Said>,
}

#[derive(Debug)]
pub struct SessionStore {
    path: Option<PathBuf>,
    saved: Saved,
}

impl SessionStore {
    /// Load `path`, or start fresh with a new desk id.
    pub fn open(path: Option<PathBuf>) -> Self {
        let mut saved: Saved = path
            .as_deref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        if saved.desk_id.is_empty() {
            saved.desk_id = new_desk_id();
        }
        let store = Self { path, saved };
        store.save();
        store
    }

    pub fn desk_id(&self) -> &str {
        &self.saved.desk_id
    }

    pub fn session_id(&self) -> Option<&str> {
        self.saved.session_id.as_deref()
    }

    pub fn set_session(&mut self, session_id: Option<String>) {
        self.saved.session_id = session_id;
        self.saved.transcript.clear();
        self.save();
    }

    pub fn record(&mut self, speaker: Speaker, text: &str) {
        let transcript = &mut self.saved.transcript;
        transcript.push(Said {
            speaker,
            text: text.to_owned(),
        });
        let extra = transcript.len().saturating_sub(KEEP);
        transcript.drain(..extra);
        self.save();
    }

    pub fn transcript(&self) -> &[Said] {
        &self.saved.transcript
    }

    fn save(&self) {
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&self.saved) {
            let _ = fs::write(path, text);
        }
    }
}

/// A random id for this desk. It names no person or machine.
fn new_desk_id() -> String {
    let random = RandomState::new();
    format!(
        "desk-{:016x}{:08x}",
        random.hash_one(std::process::id()),
        random.hash_one(std::time::SystemTime::now()) as u32
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_desk_id_and_trims_the_transcript() {
        let path = std::env::temp_dir()
            .join(format!("desk-sessions-{}", std::process::id()))
            .join("brain.json");
        let mut store = SessionStore::open(Some(path.clone()));
        let desk = store.desk_id().to_owned();
        assert!(desk.starts_with("desk-"));
        store.set_session(Some("s1".to_owned()));
        for i in 0..(KEEP + 5) {
            store.record(Speaker::Person, &format!("line {i}"));
        }
        let again = SessionStore::open(Some(path.clone()));
        assert_eq!(again.desk_id(), desk);
        assert_eq!(again.session_id(), Some("s1"));
        assert_eq!(again.transcript().len(), KEEP);
        assert_eq!(again.transcript()[0].text, "line 5");
        let _ = fs::remove_dir_all(path.parent().unwrap());
        assert_ne!(SessionStore::open(None).desk_id(), desk);
    }
}
