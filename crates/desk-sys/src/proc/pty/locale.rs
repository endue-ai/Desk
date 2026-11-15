//! The locale a PTY starts in (#323). A desk opened from Finder, at login or by launchd has no
//! `LANG`, `LC_ALL` or `LC_CTYPE`, and a shell without them runs in the C locale, where Hangul and
//! other non-ASCII text turn into escapes and `?`. As Terminal.app and iTerm2 do, a PTY whose
//! environment names none of them gets `LANG` set to a UTF-8 locale this OS has: the person's
//! language on macOS when its `.UTF-8` locale exists, else `en_US.UTF-8`; `C.UTF-8` elsewhere. Only
//! `LANG` is set, so any `LC_*` the person's shell sets still wins.

use std::collections::BTreeMap;
use std::ffi::OsString;

/// The variables that decide the character set, most specific first.
const VARS: [&str; 3] = ["LC_ALL", "LC_CTYPE", "LANG"];

/// `LANG` for a PTY whose environment is the desk's (`inherited`) plus `env`, or `None` when one
/// of `VARS` is set to something already.
pub(super) fn lang_for(
    env: &BTreeMap<String, String>,
    inherited: impl Fn(&str) -> Option<OsString>,
) -> Option<String> {
    let named = VARS.iter().any(|name| match env.get(*name) {
        Some(value) => !value.is_empty(),
        None => inherited(name).is_some_and(|value| !value.is_empty()),
    });
    (!named).then(utf8_lang)
}

#[cfg(target_os = "macos")]
fn utf8_lang() -> String {
    use objc2_foundation::NSLocale;

    let id = NSLocale::currentLocale().localeIdentifier().to_string();
    macos_lang(&id, |name| {
        std::path::Path::new("/usr/share/locale").join(name).is_dir()
    })
}

/// `<language>_<REGION>.UTF-8` for the locale `id` (`ko_KR`, `en_KR@rg=krzzzz`) when `exists`
/// says this Mac has it, else `en_US.UTF-8`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn macos_lang(id: &str, exists: impl Fn(&str) -> bool) -> String {
    let base = id.split('@').next().unwrap_or_default().replace('-', "_");
    let wanted = format!("{base}.UTF-8");
    if !base.is_empty() && exists(&wanted) {
        wanted
    } else {
        "en_US.UTF-8".to_owned()
    }
}

#[cfg(not(target_os = "macos"))]
fn utf8_lang() -> String {
    "C.UTF-8".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none(_: &str) -> Option<OsString> {
        None
    }

    #[test]
    fn a_named_variable_keeps_the_environment() {
        let given = BTreeMap::from([("LC_ALL".to_owned(), "C".to_owned())]);
        assert_eq!(lang_for(&given, none), None);
        let inherited = |name: &str| (name == "LC_CTYPE").then(|| OsString::from("UTF-8"));
        assert_eq!(lang_for(&BTreeMap::new(), inherited), None);
        // An empty value names nothing, and an empty one in `env` hides an inherited one.
        let empty = BTreeMap::from([("LANG".to_owned(), String::new())]);
        let lang = |name: &str| (name == "LANG").then(|| OsString::from("fr_FR.UTF-8"));
        assert!(lang_for(&empty, lang).is_some());
        assert!(lang_for(&BTreeMap::new(), none).is_some());
    }

    #[test]
    fn macos_takes_the_persons_language_when_it_has_its_locale() {
        let has = |name: &str| name == "ko_KR.UTF-8";
        assert_eq!(macos_lang("ko_KR", has), "ko_KR.UTF-8");
        assert_eq!(macos_lang("ko_KR@rg=krzzzz", has), "ko_KR.UTF-8");
        assert_eq!(macos_lang("en_KR", has), "en_US.UTF-8");
        assert_eq!(macos_lang("", has), "en_US.UTF-8");
    }
}
