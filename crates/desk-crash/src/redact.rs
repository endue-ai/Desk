//! What a crash report may say: paths under the person's home become `~`, and long text is cut, so
//! neither a name nor a file's contents ride along whole.

/// The longest message a report keeps, in characters.
pub const MESSAGE_MAX: usize = 512;
/// The most backtrace lines a report keeps.
pub const BACKTRACE_MAX: usize = 64;

/// `text` with `home` and any `/Users/<name>`, `/home/<name>` or `C:\Users\<name>` prefix as `~`.
pub fn redact(text: &str, home: Option<&str>) -> String {
    let mut out = match home.filter(|h| h.len() > 1) {
        Some(home) => text.replace(home.trim_end_matches(['/', '\\']), "~"),
        None => text.to_owned(),
    };
    for root in ["/Users/", "/home/", "C:\\Users\\", "C:/Users/"] {
        out = replace_homes(&out, root);
    }
    out
}

/// Every `<root><name>` in `text` as `~`; the name ends at a separator, a quote or a space.
fn replace_homes(text: &str, root: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(root) {
        out.push_str(&rest[..at]);
        let after = &rest[at + root.len()..];
        let end = after
            .find(['/', '\\', '"', '\'', ' ', ')', ':', '\n'])
            .unwrap_or(after.len());
        if end == 0 {
            out.push_str(root);
        } else {
            out.push('~');
        }
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// At most `max` characters of `text`, with `…` when it was cut.
pub fn cut(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn homes_become_a_tilde() {
        assert_eq!(redact("/Users/mira/Notes/a.md", None), "~/Notes/a.md");
        assert_eq!(
            redact("at /home/ci/x and C:\\Users\\Kai\\y", None),
            "at ~/x and ~\\y"
        );
        assert_eq!(redact("/srv/me/a", Some("/srv/me")), "~/a");
        assert_eq!(redact("/Users/", None), "/Users/");
    }

    #[test]
    fn long_text_is_cut() {
        assert_eq!(cut("abcdef", 3), "abc…");
        assert_eq!(cut("abc", 3), "abc");
    }
}
