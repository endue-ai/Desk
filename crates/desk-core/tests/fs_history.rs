//! The history fs.write keeps (ADR 0076): a write over a file whose bytes differ first keeps the old
//! bytes as a version (`history/objects/<sha256>`, indexed per path in
//! `history/paths/<sha256(real path)>.json`), fs.history lists them and fs.restore writes one back as
//! a write of its own. Bounds and broken indexes: `fs_history_limits.rs`.

mod history_support;

use std::fs;

use desk_bridge::ErrorCode;
use desk_core::{Core, Roots};
use history_support::*;
use serde_json::{Value, json};

#[test]
fn a_write_over_a_file_keeps_its_old_bytes_as_one_version() {
    let home = home();
    let core = core(&home);
    let written = write(&core, "~/notes/a.md", "# b\n");
    assert_eq!(written["bytesWritten"], 4);
    let id = written["version"]
        .as_str()
        .expect("the write names its version");
    assert!(is_version_id(id), "{id}");
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );

    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(versions.len(), 1);
    let version = &versions[0];
    assert_eq!(version["id"], id);
    assert_eq!(version["caller"], NOTES);
    assert_eq!(version["size"], 4);
    assert_eq!(version["sha256"], sha256(b"# a\n"));
    assert!(version["at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(fs::read(blob(&home, &sha256(b"# a\n"))).unwrap(), b"# a\n");
    let file = home.join("notes/a.md");
    let index: Value = serde_json::from_slice(&fs::read(index_of(&home, &file)).unwrap()).unwrap();
    assert_eq!(index["version"], 1);
    assert_eq!(index["path"], real(&file).to_string_lossy().as_ref());
    assert_eq!(index["versions"].as_array().unwrap().len(), 1);
    assert_eq!(index["versions"][0]["id"], id);
}

#[test]
fn a_new_file_and_unchanged_bytes_record_no_version() {
    let home = home();
    let core = core(&home);
    let created = write(&core, "~/notes/new.md", "fresh");
    assert!(created.get("version").is_none(), "{created}");
    assert!(
        history(&core, NOTES, "~/notes/new.md", None)
            .unwrap()
            .is_empty()
    );

    let same = write(&core, "~/notes/a.md", "# a\n");
    assert!(same.get("version").is_none(), "{same}");
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    assert!(!blob(&home, &sha256(b"# a\n")).exists());
}

#[test]
fn history_lists_newest_first_and_honours_limit() {
    let home = home();
    let core = core(&home);
    for content in ["# b\n", "# c\n", "# d\n"] {
        write(&core, "~/notes/a.md", content);
    }
    let all = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    let expected: Vec<String> = ["# c\n", "# b\n", "# a\n"]
        .iter()
        .map(|c| sha256(c.as_bytes()))
        .collect();
    assert_eq!(shas(&all), expected);
    let newest = history(&core, NOTES, "~/notes/a.md", Some(2)).unwrap();
    assert_eq!(shas(&newest), expected[..2]);
    // The same file named by its absolute path (`C:/...` on Windows) has the same history.
    let absolute = home.join("notes/a.md").to_string_lossy().replace('\\', "/");
    let folder = format!("{}/**", absolute.rsplit_once('/').unwrap().0);
    let scope = json!({ "permission": "fs:read", "paths": [folder] });
    grant(&core, "example.abs", scope.clone());
    let params = json!({ "path": absolute, "scope": scope });
    let result = call(&core, "example.abs", "fs.history", params).unwrap();
    assert_eq!(result["versions"].as_array().unwrap().len(), 3);
}

#[test]
fn history_needs_fs_read_and_restore_needs_fs_write() {
    let home = home();
    let core = core(&home);
    let id = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        history(&core, "example.other", "~/notes/a.md", None),
        Err(ErrorCode::PermissionDenied)
    );
    grant(
        &core,
        "example.reader",
        json!({ "permission": "fs:read", "paths": ["~/notes/**"] }),
    );
    assert_eq!(
        history(&core, "example.reader", "~/notes/a.md", None)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        restore(&core, "example.reader", "~/notes/a.md", &id),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn restore_puts_the_old_bytes_back_and_records_the_replaced_ones() {
    let home = home();
    let core = core(&home);
    let first = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    grant(
        &core,
        "example.undo",
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    let restored = restore(&core, "example.undo", "~/notes/a.md", &first).unwrap();
    assert_eq!(restored["bytesWritten"], 4);
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# a\n"
    );

    let versions = history(&core, NOTES, "~/notes/a.md", None).unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["id"], restored["version"]);
    assert_eq!(versions[0]["sha256"], sha256(b"# b\n"));
    assert_eq!(versions[0]["caller"], "example.undo");
    assert_eq!(versions[1]["id"], first.as_str());
}

#[test]
fn restore_of_an_unknown_version_is_not_found() {
    let home = home();
    let core = core(&home);
    write(&core, "~/notes/a.md", "# b\n");
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", "1-abcdef"),
        Err(ErrorCode::NotFound)
    );
    // A version of another file is not this file's.
    fs::write(home.join("notes/z.md"), "zz").unwrap();
    let other = write(&core, "~/notes/z.md", "yy")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", &other),
        Err(ErrorCode::NotFound)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn restore_of_a_damaged_version_is_an_io_error_and_writes_nothing() {
    let home = home();
    let core = core(&home);
    let id = write(&core, "~/notes/a.md", "# b\n")["version"]
        .as_str()
        .unwrap()
        .to_owned();
    fs::write(blob(&home, &sha256(b"# a\n")), "tampered").unwrap();
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", &id),
        Err(ErrorCode::IoError)
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/a.md")).unwrap(),
        "# b\n"
    );
}

#[test]
fn a_core_without_a_history_folder_keeps_nothing() {
    let home = home();
    let core = Core::new(Roots { home: home.clone() });
    grant(
        &core,
        NOTES,
        json!({ "permission": "fs:read", "paths": ["~/notes/**"] }),
    );
    grant(
        &core,
        NOTES,
        json!({ "permission": "fs:write", "paths": ["~/notes/**"] }),
    );
    let written = write(&core, "~/notes/a.md", "# b\n");
    assert!(written.get("version").is_none());
    assert!(
        history(&core, NOTES, "~/notes/a.md", None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        restore(&core, NOTES, "~/notes/a.md", "1-abcdef"),
        Err(ErrorCode::NotFound)
    );
}
