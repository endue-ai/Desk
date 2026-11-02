//! The history's bounds and its start (ADR 0076): desk.files' `history-max-versions` and
//! `history-max-bytes` prune the oldest versions while a blob two paths share stays until no index
//! names it, and a broken or missing history never stops the core: a corrupt index is set aside as
//! `<name>.broken` with one warning.

mod history_support;

use std::fs;

use history_support::*;
use serde_json::{Value, json};

#[test]
fn versions_beyond_max_versions_are_pruned_oldest_first() {
    let home = home();
    let init = home.join(".desk/init.yaml");
    fs::create_dir_all(init.parent().unwrap()).unwrap();
    fs::write(&init, "settings:\n  desk.files.history-max-versions: 2\n").unwrap();
    let core = core(&home).with_init_file(init);
    for content in ["# b\n", "# c\n", "# d\n"] {
        write(&core, "~/notes/a.md", content);
    }
    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(shas(&versions), [sha256(b"# c\n"), sha256(b"# b\n")]);
    assert!(!blob(&home, &sha256(b"# a\n")).exists());
}

#[test]
fn bytes_beyond_max_bytes_prune_the_oldest_and_shared_blobs_stay_while_named() {
    let home = home();
    let core = core(&home);
    // Two files with the same bytes share one blob; it stays while either index names it.
    setting(&core, "history-max-versions", json!(1));
    fs::write(home.join("notes/x.md"), "AAAAAA").unwrap();
    fs::write(home.join("notes/z.md"), "AAAAAA").unwrap();
    write(&core, "~/notes/x.md", "BBBBBB");
    write(&core, "~/notes/z.md", "CCCCCC");
    let shared = blob(&home, &sha256(b"AAAAAA"));
    assert!(shared.exists());
    write(&core, "~/notes/x.md", "DDDDDD");
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/x.md", None).unwrap()),
        [sha256(b"BBBBBB")]
    );
    assert!(shared.exists(), "z.md still names the shared blob");
    write(&core, "~/notes/z.md", "EEEEEE");
    assert!(!shared.exists(), "no index names it any more");

    // Over the byte budget, the oldest version desk-wide goes first.
    setting(&core, "history-max-versions", json!(50));
    setting(&core, "history-max-bytes", json!(12));
    fs::write(home.join("notes/y.md"), "QQQQ").unwrap();
    write(&core, "~/notes/y.md", "RRRR");
    assert!(
        history(&core, NOTES, "~/notes/x.md", None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/z.md", None).unwrap()),
        [sha256(b"CCCCCC")]
    );
    assert_eq!(
        shas(&history(&core, NOTES, "~/notes/y.md", None).unwrap()),
        [sha256(b"QQQQ")]
    );
    assert!(!blob(&home, &sha256(b"BBBBBB")).exists());
}

#[test]
fn a_corrupt_index_starts_empty_keeps_a_broken_copy_and_warns_once() {
    let home = home();
    write(&core(&home), "~/notes/a.md", "# b\n");
    let index = index_of(&home, &home.join("notes/a.md"));
    fs::write(&index, "{ not json").unwrap();

    let core = core(&home);
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    let broken = index.with_file_name(format!(
        "{}.broken",
        index.file_name().unwrap().to_string_lossy()
    ));
    assert_eq!(fs::read_to_string(&broken).unwrap(), "{ not json");
    assert!(!index.exists());

    grant(&core, "example.logs", json!({ "permission": "log:read" }));
    let tail = call(
        &core,
        "example.logs",
        "log.tail",
        json!({ "channel": "core", "scope": { "permission": "log:read" } }),
    )
    .unwrap();
    let warnings: Vec<&Value> = tail["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["level"] == "warn")
        .collect();
    assert_eq!(warnings.len(), 1, "{tail}");
    assert!(warnings[0]["message"].as_str().unwrap().contains(".broken"));

    // The history goes on from empty.
    write(&core, "~/notes/a.md", "# c\n");
    assert_eq!(
        history(&core, NOTES, "~/notes/a.md", None).unwrap().len(),
        1
    );
}

#[test]
fn a_missing_history_folder_starts_empty_and_is_created_on_the_first_write() {
    let home = home();
    let core = core(&home);
    assert!(!history_dir(&home).exists());
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    write(&core, "~/notes/a.md", "# b\n");
    assert!(index_of(&home, &home.join("notes/a.md")).exists());
}
