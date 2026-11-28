//! The text the knowledge base keeps: what a harness injected taken out, secrets masked, lengths
//! bounded at a character boundary.

use std::sync::LazyLock;

use regex::Regex;

/// What stands for a masked secret.
pub const MASK: &str = "••••";

/// Blocks a harness puts into a prompt or an answer that the person did not write. The survey of
/// this desk's sessions found tickets from CLAUDE.md riding these into 150 sessions (ADR 0403).
const INJECTED_TAGS: &[&str] = &[
    "system-reminder",
    "command-name",
    "command-message",
    "command-args",
    "command-contents",
    "local-command-stdout",
    "local-command-stderr",
    "local-command-caveat",
    "task-notification",
    "user-prompt-submit-hook",
    "environment_context",
    "user_instructions",
    "INSTRUCTIONS",
    "turn_aborted",
    "subagent_notification",
];

/// Openings of a whole message a harness wrote in the person's place.
const HARNESS_OPENINGS: &[&str] = &[
    "# AGENTS.md instructions",
    "Base directory for this skill:",
    "[Request interrupted",
    "Caveat: The messages below",
    "This session is being continued from a previous conversation",
    "<permissions instructions>",
    ">>> ",
    "The following is the Codex agent",
    "Reviewed Codex session id:",
    "The active permission profile",
    "Host notice:",
    "Within the root conversation",
];

static INJECTED: LazyLock<Regex> = LazyLock::new(|| {
    let blocks: Vec<String> = INJECTED_TAGS
        .iter()
        .map(|tag| format!(r"<{tag}\b[^>]*>.*?</{tag}>"))
        .collect();
    Regex::new(&format!("(?s){}", blocks.join("|"))).expect("injected-context pattern")
});

/// Secrets by shape: private keys, vendor tokens, JWTs, credentials in URLs.
static SECRET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        r"|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}",
        r"|\bgh[pousr]_[A-Za-z0-9]{30,}",
        r"|\bgithub_pat_[A-Za-z0-9_]{30,}",
        r"|\bglpat-[A-Za-z0-9_-]{20,}",
        r"|\bxox[abprs]-[A-Za-z0-9-]{10,}",
        r"|\bAKIA[0-9A-Z]{16}\b",
        r"|\bAIza[0-9A-Za-z_-]{35}",
        r"|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}",
    ))
    .expect("secret pattern")
});

/// A secret by name: `api_key = …`, `"password": "…"`, `Bearer …`, `https://user:pass@host`.
static ASSIGNED: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"(?i)(\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret"#,
        r#"|secret[_-]?key|secret|password|passwd|private[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}"#,
        r"|(?i)(\bbearer\s+)[A-Za-z0-9._~+/-]{16,}=*",
        r"|(https?://)[^/\s:@]+:[^/\s@]+@",
    ))
    .expect("assigned-secret pattern")
});

/// `text` without the blocks a harness injected, trimmed.
pub fn strip_injected(text: &str) -> String {
    INJECTED.replace_all(text, "").trim().to_owned()
}

/// Whether a whole message is one a harness wrote: instructions, a skill's text, an interruption.
pub fn is_harness(text: &str) -> bool {
    let text = text.trim_start();
    HARNESS_OPENINGS
        .iter()
        .any(|opening| text.starts_with(opening))
}

/// `text` with every secret it shows masked; the name of a named secret stays.
pub fn redact(text: &str) -> String {
    let masked = SECRET.replace_all(text, MASK);
    ASSIGNED
        .replace_all(&masked, |caps: &regex::Captures<'_>| {
            let kept = caps
                .get(1)
                .or_else(|| caps.get(2))
                .or_else(|| caps.get(3))
                .map_or("", |m| m.as_str());
            if caps.get(3).is_some() {
                format!("{kept}{MASK}@")
            } else {
                format!("{kept}{MASK}")
            }
        })
        .into_owned()
}

/// At most `max` characters of `text`, ending in `…` when it was cut.
pub fn clip(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        None => text.to_owned(),
        Some((at, _)) => {
            let mut cut = text[..at].trim_end().to_owned();
            cut.push('…');
            cut
        }
    }
}

/// The first line of `text` with words in it, at most `max` characters: a title.
pub fn first_line(text: &str, max: usize) -> Option<String> {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let line = line.trim_start_matches('#').trim();
    (!line.is_empty()).then(|| clip(line, max))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injected_blocks_go_and_the_prompt_stays() {
        let text = "<system-reminder>ACME-923 is in CLAUDE.md</system-reminder>\nFix the dock";
        assert_eq!(strip_injected(text), "Fix the dock");
        let nested = "<command-name>/review</command-name><command-args>12</command-args>";
        assert_eq!(strip_injected(nested), "");
    }

    #[test]
    fn harness_messages_are_told_apart() {
        assert!(is_harness(
            "# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>"
        ));
        assert!(is_harness("  Base directory for this skill: /x"));
        assert!(!is_harness("Please read AGENTS.md first"));
    }

    #[test]
    fn secrets_are_masked_and_names_kept() {
        let token = format!("gh{}_{}", "p", "a1".repeat(18));
        assert_eq!(
            redact(&format!("use {token} now")),
            format!("use {MASK} now")
        );
        let named = format!("API_KEY={}", "z9".repeat(8));
        assert_eq!(redact(&named), format!("API_KEY={MASK}"));
        let url = format!("https://me:{}@git.example.com/x", "pw".repeat(4));
        assert_eq!(redact(&url), format!("https://{MASK}@git.example.com/x"));
        assert_eq!(redact("password policy is fine"), "password policy is fine");
    }

    #[test]
    fn clip_cuts_at_a_character() {
        assert_eq!(clip("세션 지식", 2), "세션…");
        assert_eq!(clip("short", 10), "short");
        assert_eq!(
            first_line("\n\n## Title here\nbody", 80).as_deref(),
            Some("Title here")
        );
    }
}
