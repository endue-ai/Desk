//! Who is signed in, as the account bar shows it: `GET /api/v1/users/me` (`display_name`,
//! `email`, `avatar_url`), the same call the endue.ai web makes after it signs in. The picture is
//! fetched here and handed over as a data: URL, because the desk's webview loads no remote images.
//! When the user service cannot answer, the access token's own `name` and `email` claims stand in;
//! they are read for display only, never trusted for anything else.

use base64::Engine as _;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde_json::Value;

use super::Profile;
use super::bff::Bff;
use crate::account_client::origin_of;

/// The largest picture kept; a larger one leaves the initial in its place.
const MAX_PICTURE: usize = 64 * 1024;
const PICTURES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// The profile of the session whose access token is `access_token`, or `None` when nothing is known.
pub(super) fn fetch(bff: &Bff, access_token: &str) -> Option<Profile> {
    let me = bff.me(access_token).unwrap_or(Value::Null);
    let claims = claims_of(access_token).unwrap_or(Value::Null);
    let profile = Profile {
        display_name: text(&me, "display_name", 200).or_else(|| text(&claims, "name", 200)),
        email: text(&me, "email", 320).or_else(|| text(&claims, "email", 320)),
        avatar_url: text(&me, "avatar_url", 2048).and_then(|url| picture(bff, &url)),
    };
    (profile != Profile::default()).then_some(profile)
}

fn text(body: &Value, key: &str, max: usize) -> Option<String> {
    let value = body.get(key)?.as_str()?.trim();
    (!value.is_empty() && value.chars().count() <= max).then(|| value.to_owned())
}

/// The picture at `url` as a data: URL: https only (http on this computer), an image, 64 KB at most.
fn picture(bff: &Bff, url: &str) -> Option<String> {
    let origin = origin_of(url)?;
    let local = origin.starts_with("http://127.0.0.1") || origin.starts_with("http://localhost");
    if !origin.starts_with("https://") && !local {
        return None;
    }
    let reply = bff.picture(url)?;
    let kind = reply
        .header("content-type")?
        .split(';')
        .next()?
        .trim()
        .to_ascii_lowercase();
    if !PICTURES.contains(&kind.as_str()) || reply.body.is_empty() || reply.body.len() > MAX_PICTURE
    {
        return None;
    }
    Some(format!(
        "data:{kind};base64,{}",
        STANDARD.encode(&reply.body)
    ))
}

/// The claims of a JWT, unverified: for display only.
fn claims_of(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_are_read_from_the_token_payload() {
        let payload =
            URL_SAFE_NO_PAD.encode(br#"{"sub":"1","email":"ada@example.com","name":"Ada"}"#);
        let token = format!("eyJhbGciOiJSUzI1NiJ9.{payload}.signature");
        let claims = claims_of(&token).unwrap();
        assert_eq!(
            text(&claims, "email", 320).as_deref(),
            Some("ada@example.com")
        );
        assert_eq!(text(&claims, "name", 200).as_deref(), Some("Ada"));
        assert_eq!(claims_of("access1"), None);
        assert_eq!(text(&claims, "sub", 0), None);
    }
}
