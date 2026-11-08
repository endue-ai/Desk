//! Bridge paths and patterns: lexical normalisation, glob matching and pattern containment.
//!
//! Paths use forward slashes and start at a root token: `/`, a drive (`C:`), `~` or `${...}`.
//! `${home}` is the same root as `~`.

/// Collapse `.`, `..` and empty segments. `None` when `..` would leave the root or there is no root.
pub fn normalize(path: &str) -> Option<String> {
    let (root, rest) = split_root(path)?;
    let mut segments: Vec<&str> = Vec::new();
    for segment in rest.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            other => segments.push(other),
        }
    }
    let mut out = root.to_owned();
    for segment in segments {
        if !out.ends_with('/') {
            out.push('/');
        }
        out.push_str(segment);
    }
    Some(out)
}

fn split_root(path: &str) -> Option<(&str, &str)> {
    if let Some(rest) = path.strip_prefix('/') {
        return Some(("/", rest));
    }
    if path == "~" || path.starts_with("~/") {
        return Some(("~", &path[1..]));
    }
    if let Some(rest) = path.strip_prefix("${home}") {
        return (rest.is_empty() || rest.starts_with('/')).then_some(("~", rest));
    }
    if path.starts_with("${") {
        let end = path.find('}')?;
        let rest = &path[end + 1..];
        return (rest.is_empty() || rest.starts_with('/')).then_some((&path[..=end], rest));
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Some((&path[..2], &path[2..]));
    }
    None
}

fn segments(path: &str) -> Vec<&str> {
    path.split('/').collect()
}

/// Glob match on normalised paths: `*` and `?` stay within a segment, `**` spans segments,
/// and `dir/**` also matches `dir` itself.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    match (normalize(pattern), normalize(path)) {
        (Some(pattern), Some(path)) => match_segments(&segments(&pattern), &segments(&path)),
        _ => false,
    }
}

fn match_segments(pattern: &[&str], path: &[&str]) -> bool {
    match pattern.split_first() {
        None => path.is_empty(),
        Some((&"**", rest)) => {
            match_segments(rest, path) || (!path.is_empty() && match_segments(pattern, &path[1..]))
        }
        Some((first, rest)) => {
            !path.is_empty() && match_segment(first, path[0]) && match_segments(rest, &path[1..])
        }
    }
}

fn match_segment(pattern: &str, text: &str) -> bool {
    let (p, t): (Vec<char>, Vec<char>) = (pattern.chars().collect(), text.chars().collect());
    let (mut pi, mut ti, mut star, mut mark) = (0, 0, None, 0);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

fn has_wildcard(pattern: &str) -> bool {
    pattern.contains(['*', '?'])
}

/// Whether every path matched by `scope` is also matched by `grant`. Conservative: when in doubt, no.
pub fn pattern_covers(grant: &str, scope: &str) -> bool {
    let (Some(grant), Some(scope)) = (normalize(grant), normalize(scope)) else {
        return false;
    };
    if !has_wildcard(&scope) {
        return glob_match(&grant, &scope);
    }
    if grant == scope {
        return true;
    }
    match grant.strip_suffix("/**") {
        Some(prefix) if !has_wildcard(prefix) => {
            scope.starts_with(&format!("{prefix}/")) || scope == format!("{prefix}/**")
        }
        _ => false,
    }
}

/// Host match: exact (case-insensitive), or `*.domain` for any subdomain of `domain`.
pub fn host_match(pattern: &str, host: &str) -> bool {
    let (pattern, host) = (pattern.to_ascii_lowercase(), host.to_ascii_lowercase());
    match pattern.strip_prefix("*.") {
        Some(domain) => host.ends_with(&format!(".{domain}")),
        None => pattern == host,
    }
}

/// Whether every host matched by `scope` is also matched by `grant`.
pub fn host_covers(grant: &str, scope: &str) -> bool {
    match scope.strip_prefix("*.") {
        Some(domain) => grant.strip_prefix("*.").is_some_and(|g| {
            let domain = domain.to_ascii_lowercase();
            let g = g.to_ascii_lowercase();
            domain == g || domain.ends_with(&format!(".{g}"))
        }),
        None => host_match(grant, scope),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_roots_and_dots() {
        assert_eq!(normalize("~/a/./b/../c").as_deref(), Some("~/a/c"));
        assert_eq!(normalize("${home}/a").as_deref(), Some("~/a"));
        assert_eq!(normalize("/a//b/").as_deref(), Some("/a/b"));
        assert_eq!(normalize("C:/x/../y").as_deref(), Some("C:/y"));
        assert_eq!(normalize("~/..").as_deref(), None);
        assert_eq!(normalize("relative/path"), None);
    }

    #[test]
    fn globs_match_within_and_across_segments() {
        assert!(glob_match("~/Documents/*.md", "~/Documents/a.md"));
        assert!(!glob_match("~/Documents/*.md", "~/Documents/x/a.md"));
        assert!(glob_match("~/Documents/**", "~/Documents/x/a.md"));
        assert!(glob_match("~/Documents/**", "~/Documents"));
        assert!(!glob_match("~/Documents/**", "~/Desktop/a"));
    }

    #[test]
    fn containment_is_conservative() {
        assert!(pattern_covers("~/**", "~/Documents/**"));
        assert!(!pattern_covers("~/Documents/notes/**", "~/Documents/**"));
        assert!(pattern_covers("~/Documents/*.md", "~/Documents/a.md"));
        assert!(!pattern_covers("~/Documents/*.md", "~/Documents/*.txt"));
    }

    #[test]
    fn hosts_match_exactly_or_by_subdomain() {
        assert!(host_match("*.example.com", "a.b.example.com"));
        assert!(!host_match("*.example.com", "example.com"));
        assert!(host_covers("*.example.com", "*.api.example.com"));
        assert!(!host_covers("api.example.com", "*.example.com"));
    }
}
