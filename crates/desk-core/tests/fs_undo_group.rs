//! Undo groups (#313, ADR 0247): the renames and copies one action of a caller makes share a
//! `group`, and cmd.undo and cmd.redo take the entries next to each other with that caller and
//! group as one step, newest first and oldest first. Anything else stays a step of its own.

#[path = "fs_ops/support.rs"]
mod support;

use std::fs;

use desk_bridge::ErrorCode;
use serde_json::json;
use support::*;

/// A second caller with the same grants as FILES.
const OTHER: &str = "example.other";

/// `work/` with `one.txt`, `two.txt` and `three.txt` beside `a.txt`, and the folder `in/`.
fn three(home: &std::path::Path) {
    for name in ["one", "two", "three"] {
        fs::write(home.join(format!("work/{name}.txt")), name).unwrap();
    }
    fs::create_dir_all(home.join("work/in")).unwrap();
}

#[test]
fn grouped_renames_undo_and_redo_as_one_step() {
    let home = home();
    let (core, _) = core(&home);
    three(&home);
    for name in ["one", "two", "three"] {
        let ends = (&*format!("~/work/{name}.txt"), &*format!("~/work/in/{name}.txt"));
        rename_as(&core, FILES, ends, Some("paste-1")).unwrap();
    }
    assert_eq!(names(&home.join("work/in")), ["one.txt", "three.txt", "two.txt"]);

    let undone = undo(&core).unwrap();
    // One call takes the three back; the answer names the newest, with its group.
    assert_eq!(undone["undone"]["args"]["from"], "~/work/three.txt");
    assert_eq!(undone["undone"]["group"], "paste-1");
    assert!(names(&home.join("work/in")).is_empty());
    for name in ["one", "two", "three"] {
        assert_eq!(text(&home.join(format!("work/{name}.txt"))), name);
    }
    // Nothing of the group is left to undo.
    assert_eq!(undo(&core).unwrap(), json!({}));

    // One redo puts all three back, and one undo takes them back again.
    redo(&core).unwrap();
    assert_eq!(names(&home.join("work/in")), ["one.txt", "three.txt", "two.txt"]);
    assert_eq!(redo(&core).unwrap(), json!({}));
    undo(&core).unwrap();
    assert!(names(&home.join("work/in")).is_empty());
}

#[test]
fn grouped_copies_undo_as_one_step() {
    let home = home();
    let (core, trash) = core(&home);
    three(&home);
    for name in ["one", "two", "three"] {
        let ends = (&*format!("~/work/{name}.txt"), &*format!("~/work/in/{name}.txt"));
        copy_in(&core, ends, "drop-1").unwrap();
    }
    undo(&core).unwrap();
    // The copies went to the trash; the sources stay.
    assert!(names(&home.join("work/in")).is_empty());
    assert_eq!(trash.trashed().len(), 3);
    assert_eq!(text(&home.join("work/two.txt")), "two");
    assert_eq!(undo(&core).unwrap(), json!({}));
}

#[test]
fn ungrouped_and_other_callers_stay_separate_steps() {
    let home = home();
    let (core, _) = core(&home);
    three(&home);
    grant(&core, OTHER, read(&["~/work/**"]));
    grant(&core, OTHER, write(&["~/work/**"]));
    // No group, then two groups, then the same group from another caller.
    rename_as(&core, FILES, ("~/work/one.txt", "~/work/in/one.txt"), None).unwrap();
    rename_as(&core, FILES, ("~/work/two.txt", "~/work/in/two.txt"), None).unwrap();
    rename_as(&core, FILES, ("~/work/three.txt", "~/work/in/three.txt"), Some("g")).unwrap();
    rename_as(&core, OTHER, ("~/work/a.txt", "~/work/in/a.txt"), Some("g")).unwrap();
    rename_as(&core, FILES, ("~/work/docs", "~/work/in/docs"), Some("h")).unwrap();

    let steps: Vec<_> = (0..5)
        .map(|_| undo(&core).unwrap()["undone"]["args"]["from"].clone())
        .collect();
    assert_eq!(
        steps,
        [
            json!("~/work/docs"),
            json!("~/work/a.txt"),
            json!("~/work/three.txt"),
            json!("~/work/two.txt"),
            json!("~/work/one.txt"),
        ]
    );
    assert!(names(&home.join("work/in")).is_empty());
}

#[test]
fn a_group_is_one_to_128_characters() {
    let home = home();
    let (core, _) = core(&home);
    three(&home);
    let ends = ("~/work/one.txt", "~/work/in/one.txt");
    assert_eq!(rename_as(&core, FILES, ends, Some("")), Err(ErrorCode::InvalidParams));
    let long = "g".repeat(129);
    assert_eq!(rename_as(&core, FILES, ends, Some(&long)), Err(ErrorCode::InvalidParams));
    // Refused before anything moved.
    assert_eq!(text(&home.join("work/one.txt")), "one");
    rename_as(&core, FILES, ends, Some(&"g".repeat(128))).unwrap();
}
