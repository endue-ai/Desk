//! The session cookie jar, one cookie deep. The platform hands the refresh token out only as the
//! `endue_rt` cookie (HttpOnly, Path=/api/v1/auth), on the device flow's success and on every
//! refresh, which rotates it. The core takes it from `Set-Cookie` and sends it back as `Cookie` to
//! `/api/v1/auth/refresh` and `/api/v1/auth/logout`; it never crosses the bridge.

/// The cookie's name (identity-service `REFRESH_COOKIE`).
pub(super) const NAME: &str = "endue_rt";

/// What a reply's `Set-Cookie` says about `endue_rt`: a new value, cleared, or nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Change {
    Set(String),
    Cleared,
}

/// `endue_rt` in `set_cookie`, the reply's Set-Cookie headers joined with ", " (desk-sys joins
/// repeated headers so). Cookie values never hold `,` or `;`, so each cookie starts after one.
pub(super) fn from_set_cookie(set_cookie: &str) -> Option<Change> {
    let prefix = format!("{NAME}=");
    let mut found = None;
    for (i, _) in set_cookie.match_indices(&prefix) {
        let before = set_cookie[..i].trim_end_matches(' ');
        if !(before.is_empty() || before.ends_with(',')) {
            continue;
        }
        let rest = &set_cookie[i + prefix.len()..];
        let value = rest.split([';', ',']).next().unwrap_or_default().trim();
        let attributes = rest
            .split(',')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        found = Some(if value.is_empty() || attributes.contains("max-age=0") {
            Change::Cleared
        } else {
            Change::Set(value.to_owned())
        });
    }
    found
}

/// The `Cookie` header that carries `value`.
pub(super) fn header(value: &str) -> String {
    format!("{NAME}={value}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_session_cookie_is_read_from_set_cookie() {
        let set = "endue_rt=eyJ.a-b_c; Path=/api/v1/auth; Max-Age=2592000; HttpOnly; Secure; SameSite=None";
        assert_eq!(from_set_cookie(set), Some(Change::Set("eyJ.a-b_c".into())));
        let two = "endue_has_session=1; Path=/, endue_rt=rt2; Path=/api/v1/auth; HttpOnly";
        assert_eq!(from_set_cookie(two), Some(Change::Set("rt2".into())));
        assert_eq!(from_set_cookie("other_endue_rt=x; Path=/"), None);
        assert_eq!(from_set_cookie("session=1"), None);
    }

    #[test]
    fn a_deleted_cookie_is_cleared() {
        let gone = "endue_rt=; Path=/api/v1/auth; Max-Age=0; HttpOnly; Secure";
        assert_eq!(from_set_cookie(gone), Some(Change::Cleared));
        let expired = "endue_rt=old; Max-Age=0; Path=/api/v1/auth";
        assert_eq!(from_set_cookie(expired), Some(Change::Cleared));
        assert_eq!(header("rt1"), "endue_rt=rt1");
    }
}
