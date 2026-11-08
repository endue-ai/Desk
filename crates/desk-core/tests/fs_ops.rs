//! fs.stat, fs.mkdir, fs.rename, fs.copy and fs.trash (#553, ADR 0125) on temp folders: what each
//! does, the fs scopes on both ends, the typed errors, and the desk's undo reversing what changed
//! files. The trash here is a folder of the test home (`support::core`); the real OS trash is
//! `os_trash.rs`.

#[path = "fs_ops/os_trash.rs"]
mod os_trash;
#[path = "fs_ops/support.rs"]
mod support;

use std::fs;
use std::sync::atomic::Ordering;

use desk_bridge::ErrorCode;
use serde_json::json;
use support::*;

#[test]
fn stat_reports_kind_size_mtime_readonly() {
    let home = home();
    let (core, _) = core(&home);
    let file = stat(&core, "~/work/a.txt").unwrap();
    assert_eq!(file["kind"], "file");
    assert_eq!(file["size"], 5);
    assert_eq!(file["readOnly"], false);
    assert!(file["modifiedAt"].as_str().unwrap().contains('T'), "{file}");

    let folder = stat(&core, "~/work/docs").unwrap();
    assert_eq!(folder["kind"], "dir");
    assert!(folder.get("size").is_none(), "{folder}");
    assert!(folder.get("modifiedAt").is_some(), "{folder}");

    let locked = home.join("work/locked.txt");
    fs::write(&locked, "keep").unwrap();
    let mut permissions = fs::metadata(&locked).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&locked, permissions).unwrap();
    assert_eq!(stat(&core, "~/work/locked.txt").unwrap()["readOnly"], true);

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(home.join("work/a.txt"), home.join("work/link")).unwrap();
        let link = stat(&core, "~/work/link").unwrap();
        assert_eq!(link, json!({ "kind": "symlink", "readOnly": false }));
    }

    assert_eq!(stat(&core, "~/work/missing"), Err(ErrorCode::NotFound));
}

#[test]
fn mkdir_with_parents() {
    let home = home();
    let (core, _) = core(&home);
    let made = mkdir(&core, "~/work/new", false).unwrap();
    assert_eq!(made, json!({ "created": ["~/work/new"] }));
    assert!(home.join("work/new").is_dir());

    assert_eq!(
        mkdir(&core, "~/work/x/y/z", false),
        Err(ErrorCode::NotFound)
    );
    assert!(!home.join("work/x").exists());

    let made = mkdir(&core, "~/work/x/y/z", true).unwrap();
    assert_eq!(
        made["created"],
        json!(["~/work/x", "~/work/x/y", "~/work/x/y/z"])
    );
    assert!(home.join("work/x/y/z").is_dir());
    // Only what was missing is created: the rest of the path was there.
    let made = mkdir(&core, "~/work/docs/2026/11", true).unwrap();
    assert_eq!(
        made["created"],
        json!(["~/work/docs/2026", "~/work/docs/2026/11"])
    );
}

#[test]
fn rename_within_and_across_folders() {
    let home = home();
    let (core, _) = core(&home);
    let renamed = rename(&core, "~/work/a.txt", "~/work/alpha.txt").unwrap();
    assert_eq!(renamed, json!({ "crossedDevices": false }));
    assert!(!home.join("work/a.txt").exists());
    assert_eq!(text(&home.join("work/alpha.txt")), "alpha");

    // Into another folder.
    rename(&core, "~/work/alpha.txt", "~/work/docs/alpha.txt").unwrap();
    assert_eq!(names(&home.join("work/docs")), ["alpha.txt", "b.md"]);

    // A folder moves with what is in it.
    mkdir(&core, "~/work/archive", false).unwrap();
    rename(&core, "~/work/docs", "~/work/archive/docs").unwrap();
    assert!(!home.join("work/docs").exists());
    assert_eq!(text(&home.join("work/archive/docs/b.md")), "bravo");

    // Not into itself.
    assert_eq!(
        rename(&core, "~/work/archive", "~/work/archive/docs/inner"),
        Err(ErrorCode::InvalidParams)
    );
    assert_eq!(
        rename(&core, "~/work/missing", "~/work/found"),
        Err(ErrorCode::NotFound)
    );
}

#[test]
fn copy_file_and_folder() {
    let home = home();
    let (core, _) = core(&home);
    let copied = copy(&core, "~/work/a.txt", "~/work/a copy.txt").unwrap();
    assert_eq!(copied, json!({ "bytesCopied": 5 }));
    assert_eq!(text(&home.join("work/a.txt")), "alpha");
    assert_eq!(text(&home.join("work/a copy.txt")), "alpha");

    fs::create_dir_all(home.join("work/docs/deep")).unwrap();
    fs::write(home.join("work/docs/deep/c.txt"), "charlie").unwrap();
    let copied = copy(&core, "~/work/docs", "~/work/docs-copy").unwrap();
    assert_eq!(copied["bytesCopied"], 12);
    assert_eq!(names(&home.join("work/docs-copy")), ["b.md", "deep"]);
    assert_eq!(text(&home.join("work/docs-copy/deep/c.txt")), "charlie");
    assert_eq!(text(&home.join("work/docs/b.md")), "bravo");

    assert_eq!(
        copy(&core, "~/work/docs", "~/work/docs/inside"),
        Err(ErrorCode::InvalidParams)
    );
}

#[test]
fn trash_moves_to_os_trash_or_reports_unsupported() {
    let home = home();
    let (core, bin) = core(&home);
    assert_eq!(trash(&core, "~/work/a.txt").unwrap(), json!({}));
    assert!(!home.join("work/a.txt").exists());
    assert_eq!(bin.trashed(), [home.join("work/a.txt")]);
    // Folders go whole; nothing is deleted, only moved.
    trash(&core, "~/work/docs").unwrap();
    assert!(!home.join("work/docs").exists());
    assert_eq!(names(&home.join(".test-trash")).len(), 2);

    assert_eq!(trash(&core, "~/work/missing"), Err(ErrorCode::NotFound));
    // Where there is no trash, the path stays and the answer says so.
    fs::write(home.join("work/keep.txt"), "keep").unwrap();
    bin.refuse.store(true, Ordering::SeqCst);
    assert_eq!(trash(&core, "~/work/keep.txt"), Err(ErrorCode::Unsupported));
    assert_eq!(text(&home.join("work/keep.txt")), "keep");
    // The home folder itself is never moved, whatever the scope covers.
    bin.refuse.store(false, Ordering::SeqCst);
    let everything = json!({ "path": "~", "scope": write(&["~/**"]) });
    grant(&core, "example.wide", write(&["~/**"]));
    assert_eq!(
        call(&core, "example.wide", "fs.trash", everything),
        Err(ErrorCode::InvalidParams)
    );
    // A trash is not undone by the desk: nothing lands on the undo stack.
    assert_eq!(undo(&core).unwrap(), json!({}));
}

#[test]
fn every_op_refuses_paths_outside_the_callers_fs_scopes_on_both_ends() {
    let home = home();
    let (core, bin) = core(&home);
    let denied = Err(ErrorCode::PermissionDenied);
    // A scope that does not cover the path, at either end.
    assert_eq!(stat(&core, "~/other/secret.txt"), denied);
    assert_eq!(mkdir(&core, "~/other/new", false), denied);
    assert_eq!(rename(&core, "~/work/a.txt", "~/other/a.txt"), denied);
    assert_eq!(rename(&core, "~/other/secret.txt", "~/work/s.txt"), denied);
    assert_eq!(copy(&core, "~/work/a.txt", "~/other/a.txt"), denied);
    assert_eq!(copy(&core, "~/other/secret.txt", "~/work/s.txt"), denied);
    assert_eq!(trash(&core, "~/other/secret.txt"), denied);
    // A scope that covers the path, but no grant behind it.
    let wide = |params: serde_json::Value, method| call(&core, FILES, method, params);
    let other = json!({ "path": "~/other/secret.txt", "scope": write(&["~/other/**"]) });
    assert_eq!(wide(other, "fs.trash"), denied);
    let out = json!({ "from": "~/work/a.txt", "to": "~/other/a.txt",
        "scope": write(&["~/other/**"]), "fromScope": write(&["~/work/**"]) });
    assert_eq!(wide(out, "fs.rename"), denied);
    // fs:read on the source is not enough to move it; fs:write on it is not enough to copy it.
    grant(&core, FILES, read(&["~/other/**"]));
    let moved = json!({ "from": "~/other/secret.txt", "to": "~/work/s.txt",
        "scope": write(&["~/work/**"]), "fromScope": write(&["~/other/**"]) });
    assert_eq!(wide(moved, "fs.rename"), denied);
    let reader = "example.writer";
    grant(&core, reader, write(&["~/work/**"]));
    let copied = json!({ "from": "~/work/a.txt", "to": "~/work/b.txt",
        "scope": write(&["~/work/**"]), "fromScope": read(&["~/work/**"]) });
    assert_eq!(call(&core, reader, "fs.copy", copied), denied);
    // New parent folders count as writes too.
    let narrow = "example.narrow";
    grant(&core, narrow, write(&["~/work/inner/*/new"]));
    let deep = json!({ "path": "~/work/inner/x/new", "parents": true,
        "scope": write(&["~/work/inner/*/new"]) });
    assert_eq!(call(&core, narrow, "fs.mkdir", deep), denied);
    assert!(!home.join("work/inner").exists());

    // Nothing moved, nothing was trashed, nothing landed on the undo stack.
    assert_eq!(text(&home.join("other/secret.txt")), "secret");
    assert_eq!(text(&home.join("work/a.txt")), "alpha");
    assert_eq!(names(&home.join("other")), ["secret.txt"]);
    assert!(bin.trashed().is_empty());
    assert_eq!(undo(&core).unwrap(), json!({}));

    // With a grant on each end, one scope each, the move goes through.
    grant(&core, FILES, write(&["~/other/**"]));
    let moved = json!({ "from": "~/other/secret.txt", "to": "~/work/s.txt",
        "scope": write(&["~/work/**"]), "fromScope": write(&["~/other/**"]) });
    assert!(wide(moved, "fs.rename").is_ok());
    assert_eq!(text(&home.join("work/s.txt")), "secret");
}

#[test]
fn history_lets_undo_reverse_rename_move_copy_and_mkdir() {
    let home = home();
    let (core, bin) = core(&home);
    // A rename, then its undo and redo.
    rename(&core, "~/work/a.txt", "~/work/alpha.txt").unwrap();
    let undone = undo(&core).unwrap();
    assert_eq!(undone["undone"]["command"], "fs.rename");
    assert_eq!(undone["undone"]["inverse"], "fs.rename");
    assert_eq!(undone["undone"]["caller"], FILES);
    assert_eq!(
        undone["undone"]["args"],
        json!({ "from": "~/work/a.txt", "to": "~/work/alpha.txt" })
    );
    assert_eq!(text(&home.join("work/a.txt")), "alpha");
    assert!(!home.join("work/alpha.txt").exists());
    redo(&core).unwrap();
    assert_eq!(text(&home.join("work/alpha.txt")), "alpha");
    undo(&core).unwrap();
    assert_eq!(text(&home.join("work/a.txt")), "alpha");

    // A move into another folder.
    rename(&core, "~/work/a.txt", "~/work/docs/a.txt").unwrap();
    undo(&core).unwrap();
    assert_eq!(names(&home.join("work/docs")), ["b.md"]);
    assert_eq!(text(&home.join("work/a.txt")), "alpha");

    // A copy is undone by moving the copy to the trash; the source stays.
    copy(&core, "~/work/docs", "~/work/docs copy").unwrap();
    let undone = undo(&core).unwrap();
    assert_eq!(undone["undone"]["inverse"], "fs.trash");
    assert!(!home.join("work/docs copy").exists());
    assert_eq!(bin.trashed(), [home.join("work/docs copy")]);
    assert_eq!(text(&home.join("work/docs/b.md")), "bravo");
    redo(&core).unwrap();
    assert_eq!(text(&home.join("work/docs copy/b.md")), "bravo");

    // A new folder, with the parents it made, is removed while still empty.
    mkdir(&core, "~/work/x/y", true).unwrap();
    let undone = undo(&core).unwrap();
    assert_eq!(undone["undone"]["inverse"], "fs.rmdir");
    assert_eq!(
        undone["undone"]["result"]["created"],
        json!(["~/work/x", "~/work/x/y"])
    );
    assert!(!home.join("work/x").exists());
    redo(&core).unwrap();
    assert!(home.join("work/x/y").is_dir());
    // Once it holds something, undo leaves it, and the entry, where they are.
    fs::write(home.join("work/x/y/note.md"), "mine").unwrap();
    assert_eq!(undo(&core), Err(ErrorCode::InvalidParams));
    assert_eq!(text(&home.join("work/x/y/note.md")), "mine");
    fs::remove_file(home.join("work/x/y/note.md")).unwrap();
    assert_eq!(undo(&core).unwrap()["undone"]["command"], "fs.mkdir");
    assert!(!home.join("work/x").exists());

    // Undo needs a cmd:invoke scope covering the inverse.
    rename(&core, "~/work/a.txt", "~/work/z.txt").unwrap();
    let narrow = json!({ "scope": { "permission": "cmd:invoke", "ids": ["fs.trash"] } });
    grant(
        &core,
        "example.undoer",
        json!({ "permission": "cmd:invoke", "ids": ["fs.trash"] }),
    );
    assert_eq!(
        call(&core, "example.undoer", "cmd.undo", narrow),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(text(&home.join("work/z.txt")), "alpha");
}

#[test]
fn name_conflict_is_a_typed_error_not_an_overwrite() {
    let home = home();
    let (core, _) = core(&home);
    let exists = Err(ErrorCode::AlreadyExists);
    fs::write(home.join("work/b.txt"), "beta").unwrap();
    assert_eq!(rename(&core, "~/work/a.txt", "~/work/b.txt"), exists);
    assert_eq!(copy(&core, "~/work/a.txt", "~/work/b.txt"), exists);
    assert_eq!(text(&home.join("work/a.txt")), "alpha");
    assert_eq!(text(&home.join("work/b.txt")), "beta");
    // A folder onto a folder, and a folder that is already there.
    fs::create_dir(home.join("work/empty")).unwrap();
    assert_eq!(rename(&core, "~/work/docs", "~/work/empty"), exists);
    assert_eq!(copy(&core, "~/work/docs", "~/work/empty"), exists);
    assert_eq!(mkdir(&core, "~/work/docs", false), exists);
    assert_eq!(mkdir(&core, "~/work/docs", true), exists);
    assert_eq!(text(&home.join("work/docs/b.md")), "bravo");
    assert!(names(&home.join("work/empty")).is_empty());

    // An undo whose way back is taken is refused too, and nothing is overwritten.
    rename(&core, "~/work/a.txt", "~/work/c.txt").unwrap();
    fs::write(home.join("work/a.txt"), "new alpha").unwrap();
    assert_eq!(undo(&core), exists);
    assert_eq!(text(&home.join("work/a.txt")), "new alpha");
    assert_eq!(text(&home.join("work/c.txt")), "alpha");
}
