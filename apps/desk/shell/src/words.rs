//! The shell's words (ADR 0250, ADR 0276): the menu bar, the tray, the dialogs' titles and the
//! notices the shell sends read them from its catalogs, `apps/desk/shell/messages/{en,ko}.json` in
//! the format of `specs/plugin/v0/messages.schema.json`, embedded at build time. The lookup is
//! `messageText`'s (`@endue-ai/bridge`): a language that lacks an id reads it in English, an id
//! English lacks too reads as the id itself, and `{name}` is filled from the parameters, a missing
//! one reading as nothing.

use std::sync::LazyLock;

use desk_bridge::{Message, MessageCatalog};

/// The languages the desk speaks. English comes first: it is the fallback.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Language {
    #[default]
    En,
    Ko,
}

impl Language {
    pub const ALL: [Language; 2] = [Language::En, Language::Ko];

    /// Its code, as `desk.language` and the catalogs' file names write it.
    pub fn code(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::Ko => "ko",
        }
    }

    /// The language a code names (`en`, `ko`), if the desk speaks it.
    pub fn of(code: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|language| language.code() == code)
    }
}

const EN: &str = include_str!("../messages/en.json");
const KO: &str = include_str!("../messages/ko.json");

/// The catalogs, English's first. One that does not read (a test catches it) is empty here.
static CATALOGS: LazyLock<[MessageCatalog; 2]> = LazyLock::new(|| [parse(EN), parse(KO)]);

fn parse(text: &str) -> MessageCatalog {
    serde_json::from_str(text).unwrap_or_else(|why| {
        eprintln!("endue: a catalog of the shell's words does not read ({why})");
        MessageCatalog::new()
    })
}

/// The catalog of `language`.
pub fn catalog(language: Language) -> &'static MessageCatalog {
    &CATALOGS[language as usize]
}

/// Message `id` in `language`, as written: `{name}` and all, for a caller that fills it later.
pub fn text(language: Language, id: &str) -> String {
    lookup(language, id, None)
}

/// Message `id` in `language`, each `{name}` replaced by its parameter; one not given reads as
/// nothing. A plural message takes its form from the `count` parameter.
pub fn filled(language: Language, id: &str, params: &[(&str, &str)]) -> String {
    lookup(language, id, Some(params))
}

fn lookup(language: Language, id: &str, params: Option<&[(&str, &str)]>) -> String {
    let (message, rules) = match catalog(language).get(id) {
        Some(own) => (own, language),
        None => match catalog(Language::En).get(id) {
            Some(english) => (english, Language::En),
            None => return id.to_owned(),
        },
    };
    let count = params.and_then(|params| param(params, "count"));
    let chosen = match message {
        Message::MessageText(text) => text,
        Message::Plural(plural) => match count.map(|count| category(rules, count)) {
            Some(Category::One) => plural.one.as_ref().unwrap_or(&plural.other),
            _ => &plural.other,
        },
    };
    match params {
        Some(params) => fill(chosen, params),
        None => chosen.clone(),
    }
}

fn param<'a>(params: &[(&str, &'a str)], name: &str) -> Option<&'a str> {
    params.iter().find(|(key, _)| *key == name).map(|(_, v)| *v)
}

/// The plural categories English and Korean use (`Intl.PluralRules`): English's `one` is the
/// count 1 written without a fraction; Korean has only `other`.
#[derive(Debug, PartialEq, Eq)]
enum Category {
    One,
    Other,
}

fn category(language: Language, count: &str) -> Category {
    match language {
        Language::En if count.trim() == "1" => Category::One,
        _ => Category::Other,
    }
}

/// Each `{name}` (word characters) replaced by its parameter; one not given reads as nothing.
fn fill(template: &str, params: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let name_len = after
            .find(|c: char| !(c.is_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        if name_len > 0 && after[name_len..].starts_with('}') {
            out.push_str(param(params, &after[..name_len]).unwrap_or(""));
            rest = &after[name_len + 1..];
        } else {
            out.push('{');
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::{Category, Language, catalog, category, fill, filled};

    #[test]
    fn both_catalogs_read_and_english_is_complete() {
        for language in Language::ALL {
            assert!(!catalog(language).is_empty(), "{language:?}");
            assert_eq!(Language::of(language.code()), Some(language));
        }
        let english = catalog(Language::En);
        assert!(
            catalog(Language::Ko)
                .keys()
                .all(|id| english.contains_key(id))
        );
        assert_eq!(
            catalog(Language::Ko).len(),
            english.len(),
            "Korean says every word"
        );
    }

    #[test]
    fn parameters_fill_by_name_and_braces_without_one_stay() {
        assert_eq!(fill("{a} and {b}", &[("a", "1"), ("b", "2")]), "1 and 2");
        assert_eq!(fill("{missing}!", &[]), "!");
        assert_eq!(fill("{ not one } {", &[]), "{ not one } {");
        assert_eq!(fill("키 {key} 는", &[("key", "⌥↩")]), "키 ⌥↩ 는");
    }

    #[test]
    fn english_has_one_for_a_single_thing_and_korean_only_other() {
        assert_eq!(category(Language::En, "1"), Category::One);
        assert_eq!(category(Language::En, "1.0"), Category::Other);
        assert_eq!(category(Language::En, "2"), Category::Other);
        assert_eq!(category(Language::Ko, "1"), Category::Other);
        assert_eq!(
            filled(Language::Ko, "desk.no.such", &[("count", "1")]),
            "desk.no.such"
        );
    }
}
