//! studio.agents.picture (ADR 0232): an agent's face as a data: URL, read by the core from the
//! address endue AI names, once, and never with the token.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use super::*;

const PNG: &[u8] = &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG: &[u8] = b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>";

/// A core whose faces without a picture are drawn by the fake, at `/drawn`.
fn desk_with_faces(tag: &str, fake: &FakePlatform) -> Core {
    let drawn = format!("{}/drawn", fake.url());
    let platform = platform(fake, Some("token-1")).with_drawn(&drawn);
    let core = Core::new(roots(&home(tag))).with_platform(platform);
    grant(&core, AGENTS, json!({ "permission": "studio:manage" }));
    core
}

fn serve(fake: &FakePlatform, path: &str, kind: &str, bytes: &[u8]) {
    let picture = (kind.to_owned(), bytes.to_vec());
    fake.state().pictures.insert(path.to_owned(), picture);
}

#[test]
fn a_character_is_the_face_and_is_read_once() {
    let fake = FakePlatform::start();
    let core = desk_with_faces("studio-face", &fake);
    let id = fake.state().add_agent("Miso", "Mail");
    let address = format!("{}/c/miso.png", fake.url());
    fake.state().agents[0].more = json!({
        "character_image_url": address, "avatar_url": "https://cdn.example.com/photo.png"
    });
    serve(&fake, "/c/miso.png", "image/png", PNG);

    let face = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap();
    let data = format!("data:image/png;base64,{}", STANDARD.encode(PNG));
    assert_eq!(
        face,
        json!({ "agentId": id, "picture": data, "source": "character" })
    );
    let again = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap();
    assert_eq!(again, face);
    let reads = fake.seen_at("GET", "/c/miso.png");
    assert_eq!(reads.len(), 1, "kept by address");
    assert!(!reads[0].headers.contains_key("authorization"), "no token");
}

#[test]
fn an_agent_without_a_picture_gets_the_one_drawn_from_its_slug() {
    let fake = FakePlatform::start();
    let core = desk_with_faces("studio-face-drawn", &fake);
    let id = fake.state().add_agent("Miso", "Mail");
    serve(&fake, "/drawn", "image/svg+xml", SVG);
    let face = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap();
    assert_eq!(face["source"], "drawn");
    let data = format!("data:image/svg+xml;base64,{}", STANDARD.encode(SVG));
    assert_eq!(face["picture"], data);
    let seed = &fake.seen_at("GET", "/drawn")[0].query["seed"];
    assert_eq!(seed, "miso-7c9aa2bd");
}

#[test]
fn a_picture_that_cannot_be_read_is_left_out_and_asked_for_again() {
    let fake = FakePlatform::start();
    let core = desk_with_faces("studio-face-none", &fake);
    let id = fake.state().add_agent("Miso", "Mail");
    let address = format!("{}/c/miso.png", fake.url());
    fake.state().agents[0].more = json!({ "avatar_url": address });
    serve(&fake, "/c/miso.png", "text/html", b"<html>");
    let none = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap();
    assert_eq!(none, json!({ "agentId": id }));

    serve(&fake, "/c/miso.png", "image/png", PNG);
    let face = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap();
    assert_eq!(face["source"], "photo");
    assert!(
        face["picture"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
}

#[test]
fn another_persons_agent_has_no_face_here() {
    let fake = FakePlatform::start();
    let core = desk_with_faces("studio-face-foreign", &fake);
    let id = fake.state().add_foreign_agent("Theirs");
    let refused = studio(&core, "studio.agents.picture", json!({ "agentId": id })).unwrap_err();
    assert_eq!(refused.code, ErrorCode::Forbidden);
}

#[test]
fn the_list_says_what_the_card_and_the_board_show() {
    let fake = FakePlatform::start();
    let core = desk_with_faces("studio-face-list", &fake);
    fake.state().add_agent("Miso", "Mail");
    fake.state().agents[0].description = Some("  Keeps my mail  ".to_owned());
    fake.state().agents[0].more = json!({ "live_enabled": true, "mcp_enabled": false });
    let listed = studio(&core, "studio.agents.list", json!({})).unwrap();
    let agent = &listed["agents"][0];
    assert_eq!(agent["description"], "Keeps my mail");
    assert_eq!(
        (&agent["liveEnabled"], &agent["mcpEnabled"]),
        (&json!(true), &json!(false))
    );
}
