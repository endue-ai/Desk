//! An agent's face (ADR 0232) against the in-process fake platform: which picture it is, and that a
//! picture is read without the token and only when it is an image a page can carry.

use std::sync::Arc;

use desk_platform::fake::FakePlatform;
use desk_platform::{Face, MAX_PICTURE, Platform, Tokens};
use serde_json::json;

struct Token;

impl Tokens for Token {
    fn token(&self) -> Option<String> {
        Some("token-1".to_owned())
    }

    fn refresh(&self, _rejected: &str) -> Option<String> {
        None
    }
}

fn platform(fake: &FakePlatform) -> Platform {
    Platform::new(fake.url(), Arc::new(Token)).unwrap()
}

/// A 1x1 PNG.
const DOT: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
];

#[test]
fn a_face_is_the_character_then_the_photo_then_drawn_from_the_slug() {
    let fake = FakePlatform::start();
    let id = fake.state().add_agent("Miso", "Mail");
    let client = platform(&fake).with_drawn(&format!("{}/drawn", fake.url()));
    let drawn = client.face_of(&client.get_agent(&id).unwrap());
    assert_eq!(drawn.1, Face::Drawn);
    assert!(
        drawn.0.ends_with("/drawn?seed=miso-7c9aa2bd"),
        "{}",
        drawn.0
    );

    let photo = "https://cdn.endue.ai/a/miso.png";
    fake.state().agents[0].more = json!({ "avatar_url": photo, "live_enabled": true });
    let agent = client.get_agent(&id).unwrap();
    assert_eq!(client.face_of(&agent), (photo.to_owned(), Face::Photo));
    assert_eq!((agent.live_enabled, agent.mcp_enabled), (Some(true), None));

    let character = "https://cdn.endue.ai/c/miso.webp";
    fake.state().agents[0].more = json!({ "avatar_url": photo, "character_image_url": character });
    let face = client.face_of(&client.get_agent(&id).unwrap());
    assert_eq!(face, (character.to_owned(), Face::Character));
}

#[test]
fn a_picture_is_read_without_the_token_and_only_when_it_is_an_image_that_fits() {
    let fake = FakePlatform::start();
    let client = platform(&fake);
    let at = |path: &str| format!("{}{path}", fake.url());
    let png = ("image/png".to_owned(), DOT.to_vec());
    fake.state().pictures.insert("/p/dot.png".to_owned(), png);
    let read = client.picture(&at("/p/dot.png")).expect("the picture");
    assert_eq!(
        (read.kind.as_str(), read.bytes.as_slice()),
        ("image/png", DOT)
    );
    let seen = fake.seen_at("GET", "/p/dot.png");
    assert!(!seen[0].headers.contains_key("authorization"), "no token");
    assert_eq!(seen[0].headers["user-agent"], "endue");

    let page = ("text/html".to_owned(), b"<html>".to_vec());
    fake.state().pictures.insert("/p/page".to_owned(), page);
    assert_eq!(client.picture(&at("/p/page")), None, "not an image");
    let large = ("image/png".to_owned(), vec![0; MAX_PICTURE + 1]);
    fake.state()
        .pictures
        .insert("/p/large.png".to_owned(), large);
    assert_eq!(client.picture(&at("/p/large.png")), None, "too large");
    assert_eq!(client.picture(&at("/p/missing.png")), None, "not there");
    // Plain http is read on the platform's own host alone, and nothing but http(s) at all.
    assert_eq!(client.picture("http://cdn.example.com/a.png"), None);
    assert_eq!(client.picture("file:///etc/hosts"), None);
    assert_eq!(client.picture("/p/dot.png"), None);
}

/// Issue 352: a picture comes only from a public name over https (port 443), or from the
/// platform's own host. An IP literal, a private name or another port is never asked.
#[test]
fn a_picture_is_never_read_from_an_ip_literal_or_a_private_name() {
    let fake = FakePlatform::start();
    let client = platform(&fake);
    for url in [
        "https://10.0.0.1/a.png",
        "https://192.168.1.2/a.png",
        "https://127.0.0.1/a.png",
        "https://[::1]/a.png",
        "https://[fd00::1]/a.png",
        "https://localhost/a.png",
        "https://printer.local/a.png",
        "https://db.internal/a.png",
        "https://app.localhost/a.png",
        "https://cdn.example:8443/a.png",
        "http://cdn.endue.ai/a.png",
    ] {
        assert!(!client.may_read_picture(url), "{url}");
        assert_eq!(client.picture(url), None, "{url}");
    }
    for url in [
        "https://cdn.endue.ai/a/miso.png",
        "https://api.dicebear.com/9.x/bottts-neutral/svg?seed=miso",
        "https://cdn.endue.ai:443/a.png",
    ] {
        assert!(client.may_read_picture(url), "{url}");
    }
    assert!(
        client.may_read_picture(&format!("{}/p/dot.png", fake.url())),
        "the platform's own host, as in development"
    );
}
