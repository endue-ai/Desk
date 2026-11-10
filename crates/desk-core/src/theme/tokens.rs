//! theme.tokens: the latest table the runtime sent, its revision, and who hears a new one. The table
//! is kept whole, references included; checks are the ones the spec's ThemeTokenMap states, since
//! the generated types cannot carry them.

use std::collections::BTreeMap;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use desk_bridge::{BridgeError, ThemeContrast, ThemeScheme, ThemeTokensParams};
use serde_json::json;

use crate::core_themes::invalid;
use crate::handler::{Answer, Core};

/// The spec's limits on a table (`ThemeTokenMap`, `ThemeTokenName`).
const TOKENS_MAX: usize = 1024;
const NAME_MAX: usize = 64;
const VALUE_MAX: usize = 1024;

/// The look in force as the compositor reads it: every token by its camelCase name with its CSS
/// value (`var(--desk-<token>)` references as sent), and what was resolved to get it.
#[derive(Debug, Clone, PartialEq)]
pub struct TokenTable {
    /// Moves each time the table changes; 0 until the runtime sends one.
    pub revision: u64,
    pub scheme: ThemeScheme,
    pub contrast: ThemeContrast,
    pub reduced_motion: bool,
    /// The theme plugin in force; empty for the desk's own.
    pub theme: String,
    /// The design system in force; empty for the endue design system.
    pub design: String,
    pub tokens: BTreeMap<String, String>,
}

impl Default for TokenTable {
    fn default() -> TokenTable {
        TokenTable {
            revision: 0,
            scheme: ThemeScheme::Dark,
            contrast: ThemeContrast::Normal,
            reduced_motion: false,
            theme: String::new(),
            design: String::new(),
            tokens: BTreeMap::new(),
        }
    }
}

impl TokenTable {
    /// A token's value as sent, `None` when the table has no such token.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.tokens.get(name).map(String::as_str)
    }

    /// The same look, revision aside.
    fn same_look(&self, other: &TokenTable) -> bool {
        TokenTable {
            revision: other.revision,
            ..self.clone()
        } == *other
    }
}

/// The table in force and the watchers of new ones.
#[derive(Default)]
pub(crate) struct ThemeTokens {
    current: Mutex<Arc<TokenTable>>,
    watchers: Mutex<Vec<Sender<Arc<TokenTable>>>>,
}

impl Core {
    /// The look in force: the latest table theme.tokens brought, or an empty one before the first.
    pub fn theme_tokens(&self) -> Arc<TokenTable> {
        Arc::clone(&lock(&self.theme_tokens.current))
    }

    /// Every new table from now on, in order (a repeated one is not announced). Dropping the
    /// receiver stops it.
    pub fn watch_theme_tokens(&self) -> Receiver<Arc<TokenTable>> {
        let (sender, receiver) = mpsc::channel();
        lock(&self.theme_tokens.watchers).push(sender);
        receiver
    }

    pub(crate) fn theme_tokens_set(&self, caller: &str, params: ThemeTokensParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        check(&params.tokens)?;
        let count = params.tokens.len();
        let sent = TokenTable {
            revision: 0,
            scheme: params.scheme,
            contrast: params.contrast,
            reduced_motion: params.reduced_motion,
            theme: params.theme.unwrap_or_default(),
            design: params.design.unwrap_or_default(),
            tokens: params.tokens,
        };
        let mut current = lock(&self.theme_tokens.current);
        if current.revision > 0 && current.same_look(&sent) {
            return Ok(json!({ "revision": current.revision, "tokens": count }));
        }
        let table = Arc::new(TokenTable {
            revision: current.revision + 1,
            ..sent
        });
        *current = Arc::clone(&table);
        drop(current);
        lock(&self.theme_tokens.watchers)
            .retain(|watcher| watcher.send(Arc::clone(&table)).is_ok());
        Ok(json!({ "revision": table.revision, "tokens": count }))
    }
}

/// The spec's ThemeTokenMap: at most 1024 tokens, camelCase names of 64 bytes at most, values of
/// 1024 bytes at most.
fn check(tokens: &BTreeMap<String, String>) -> Result<(), BridgeError> {
    if tokens.len() > TOKENS_MAX {
        return Err(invalid(format!(
            "{} tokens; a table holds {TOKENS_MAX} at most",
            tokens.len()
        )));
    }
    if let Some(name) = tokens.keys().find(|name| !is_name(name)) {
        return Err(invalid(format!(
            "{name:?} is not a token name (camelCase, as textMuted)"
        )));
    }
    if let Some((name, _)) = tokens.iter().find(|(_, value)| value.len() > VALUE_MAX) {
        return Err(invalid(format!("{name}'s value is over {VALUE_MAX} bytes")));
    }
    Ok(())
}

/// `^[a-z][A-Za-z0-9]*$`, 64 bytes at most.
fn is_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= NAME_MAX
        && chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_alphanumeric())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_camel_case() {
        assert!(is_name("textMuted"));
        assert!(is_name("text2xs"));
        assert!(!is_name("TextMuted"));
        assert!(!is_name("--desk-text"));
        assert!(!is_name("text-muted"));
        assert!(!is_name(""));
        assert!(!is_name(&"a".repeat(65)));
    }
}
