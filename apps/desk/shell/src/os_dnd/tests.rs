use std::path::{Path, PathBuf};

use desk_surface::generated::{SurfaceDropAnswer, SurfaceDropEffect};

use super::{OP_COPY, OP_LINK, OP_MOVE, effect_of, local_path, operation_mask, pasteboard_data};

#[test]
fn the_effects_a_drag_allows_are_the_os_operations_it_offers() {
    use SurfaceDropEffect::{Copy, Link, Move};
    assert_eq!(
        operation_mask(&[Copy, Move, Link]),
        OP_COPY | OP_MOVE | OP_LINK
    );
    assert_eq!(operation_mask(&[Copy]), OP_COPY);
    assert_eq!(operation_mask(&[]), 0);
}

#[test]
fn what_the_os_did_is_the_drags_effect() {
    assert_eq!(effect_of(0), SurfaceDropAnswer::None);
    assert_eq!(effect_of(OP_COPY), SurfaceDropAnswer::Copy);
    assert_eq!(effect_of(OP_LINK), SurfaceDropAnswer::Link);
    assert_eq!(effect_of(OP_MOVE), SurfaceDropAnswer::Move);
    // Finder answers a move with both bits on some volumes: the move is what happened.
    assert_eq!(effect_of(OP_MOVE | OP_COPY), SurfaceDropAnswer::Move);
}

#[test]
fn bridge_paths_are_the_oss() {
    let home = Path::new("/Users/person");
    assert_eq!(
        local_path("~/Notes/a.md", home),
        PathBuf::from("/Users/person/Notes/a.md")
    );
    assert_eq!(local_path("~", home), PathBuf::from("/Users/person"));
    assert_eq!(local_path("/tmp/x.png", home), PathBuf::from("/tmp/x.png"));
    assert_eq!(local_path("~other/x", home), PathBuf::from("~other/x"));
}

#[test]
fn a_pasteboards_text_and_url_are_desk_data() {
    let owned = |s: &str| Some(s.to_owned());
    // A URL the pasteboard names as one.
    assert_eq!(
        pasteboard_data(owned("Endue"), owned("https://endue.ai/")),
        (owned("Endue"), vec!["https://endue.ai/".to_owned()])
    );
    // Text that is one link and nothing else is a link too.
    assert_eq!(
        pasteboard_data(owned(" https://endue.ai/docs "), None),
        (
            owned(" https://endue.ai/docs "),
            vec!["https://endue.ai/docs".to_owned()]
        )
    );
    // Other text, or a scheme that is not a page's, is text only.
    assert_eq!(
        pasteboard_data(owned("see https://x.y"), None),
        (owned("see https://x.y"), vec![])
    );
    assert_eq!(
        pasteboard_data(owned("javascript:alert(1)"), None).1,
        Vec::<String>::new()
    );
    assert_eq!(pasteboard_data(None, None), (None, vec![]));
    assert_eq!(pasteboard_data(owned(""), owned("")), (None, vec![]));
}
