//! The flat token table the compositor reads (ADR 0145): every token of the look in force by its
//! camelCase name with its CSS value, as `theme.tokens` carries it from the runtime through the
//! core. Values may reference other tokens (`var(--desk-radius-lg)`, the design system's component
//! tokens do); reading one follows them. The compositor never reads a theme file.

use crate::text::FontStack;
use crate::theme::css;
use crate::types::{Color, Shadow};
use std::collections::BTreeMap;

/// How many references deep a value is followed before it reads as unknown (a cycle).
const DEPTH: usize = 8;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tokens {
    values: BTreeMap<String, String>,
}

impl<K: Into<String>, V: Into<String>> FromIterator<(K, V)> for Tokens {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(iter: I) -> Tokens {
        Tokens {
            values: iter
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
        }
    }
}

impl Tokens {
    pub fn len(&self) -> usize {
        self.values.len()
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// A token's value as the table holds it.
    pub fn raw(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    /// A token's value with every `var(--desk-<token>[, fallback])` replaced by what it names (or
    /// its fallback); `None` when the token is missing or a reference cannot be resolved.
    pub fn resolve(&self, name: &str) -> Option<String> {
        self.expand(self.raw(name)?, DEPTH)
    }

    fn expand(&self, value: &str, depth: usize) -> Option<String> {
        let Some(start) = value.find("var(") else {
            return Some(value.to_owned());
        };
        if depth == 0 {
            return None;
        }
        let inner_start = start + 4;
        let end = closing(value, inner_start)?;
        let inner = &value[inner_start..end];
        let (property, fallback) = match inner.split_once(',') {
            Some((p, f)) => (p.trim(), Some(f.trim())),
            None => (inner.trim(), None),
        };
        let named = property
            .strip_prefix("--desk-")
            .map(token_name)
            .and_then(|n| self.raw(&n).map(str::to_owned));
        let replacement = match (named, fallback) {
            (Some(v), _) => self.expand(&v, depth - 1)?,
            (None, Some(f)) => self.expand(f, depth - 1)?,
            (None, None) => return None,
        };
        let rest = self.expand(&value[end + 1..], depth)?;
        Some(format!("{}{replacement}{rest}", &value[..start]))
    }

    pub fn color(&self, name: &str) -> Option<Color> {
        css::color(&self.resolve(name)?)
    }

    pub fn length(&self, name: &str) -> Option<f32> {
        css::length(&self.resolve(name)?)
    }

    /// A `box-shadow` token: `Some(None)` for `none`.
    pub fn shadow(&self, name: &str) -> Option<Option<Shadow>> {
        css::shadow(&self.resolve(name)?)
    }

    pub fn font(&self, name: &str) -> Option<FontStack> {
        let stack = self.resolve(name)?;
        (!stack.trim().is_empty()).then(|| FontStack::new(&stack))
    }

    pub fn number(&self, name: &str) -> Option<f32> {
        self.resolve(name)?.trim().parse().ok()
    }
}

/// The index of the `)` closing the parenthesis opened before `from`.
fn closing(value: &str, from: usize) -> Option<usize> {
    let mut depth = 1usize;
    for (i, c) in value[from..].char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(from + i);
                }
            }
            _ => {}
        }
    }
    None
}

/// A custom property's tail as its token's name: `text-muted` is `textMuted`, `text-2xs` is
/// `text2xs`, `chart-1` is `chart1` (the reverse of `@endue-ai/ui`'s `propertyOf`).
fn token_name(property: &str) -> String {
    let mut name = String::with_capacity(property.len());
    let mut upper = false;
    for c in property.chars() {
        if c == '-' {
            upper = true;
        } else if upper {
            name.extend(c.to_uppercase());
            upper = false;
        } else {
            name.push(c);
        }
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_names_map_back_to_token_names() {
        assert_eq!(token_name("text-muted"), "textMuted");
        assert_eq!(token_name("text-2xs"), "text2xs");
        assert_eq!(token_name("chart-1"), "chart1");
        assert_eq!(token_name("primary-soft"), "primarySoft");
    }

    #[test]
    fn references_are_followed_with_fallbacks_and_cycles_read_as_unknown() {
        let tokens: Tokens = [
            ("radiusLg", "12px"),
            ("toastRadius", "var(--desk-radius-lg)"),
            ("deep", "var(--desk-toast-radius)"),
            ("withFallback", "var(--desk-missing, 6px)"),
            ("shadow", "inset 0 -2px 0 var(--desk-primary)"),
            ("primary", "#b6a3f5"),
            ("loopA", "var(--desk-loop-b)"),
            ("loopB", "var(--desk-loop-a)"),
            ("dangling", "var(--desk-nowhere)"),
        ]
        .into_iter()
        .collect();
        assert_eq!(tokens.length("toastRadius"), Some(12.0));
        assert_eq!(tokens.length("deep"), Some(12.0));
        assert_eq!(tokens.length("withFallback"), Some(6.0));
        assert_eq!(
            tokens.resolve("shadow").as_deref(),
            Some("inset 0 -2px 0 #b6a3f5")
        );
        assert_eq!(tokens.resolve("loopA"), None);
        assert_eq!(tokens.resolve("dangling"), None);
        assert_eq!(tokens.resolve("missing"), None);
    }
}
