//! desk-sys fs operations (feature `fs`): stat, mkdir, rename and copy, each on a temp folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_sys::fs::{EntryKind, copy, mkdir, rename, stat};
use desk_sys::{Error, ErrorCode};

/// The bridge code an fs error maps to.
fn code(err: std::io::Error) -> ErrorCode {
    Error::from(err).code
}

/// Keeps the folders of tests that read the same nanosecond apart.
static NEXT: AtomicU32 = AtomicU32::new(0);

/// A fresh folder holding `b.txt` ("hello") and an empty `sub/`.
fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("desk-sys-ops-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("sub")).unwrap();
    fs::write(dir.join("b.txt"), "hello").unwrap();
    dir
}

/// The names in `dir`, sorted.
fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn make_readonly(path: &Path) {
    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).unwrap();
}

fn is_readonly(path: &Path) -> bool {
    fs::metadata(path).unwrap().permissions().readonly()
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

#[test]
fn stat_reports_kind_size_modified_and_readonly() {
    let dir = temp_dir();
    let file = dir.join("b.txt");
    let stat_of_file = stat(&file).unwrap();
    assert_eq!(stat_of_file.kind, EntryKind::File);
    assert_eq!(stat_of_file.size, Some(5));
    assert!(stat_of_file.modified.is_some());
    assert_eq!(
        stat_of_file.modified,
        fs::metadata(&file).unwrap().modified().ok()
    );
    assert!(!stat_of_file.readonly);

    make_readonly(&file);
    assert!(stat(&file).unwrap().readonly);

    let folder = stat(&dir.join("sub")).unwrap();
    assert_eq!((folder.kind, folder.size), (EntryKind::Dir, None));
    assert!(folder.modified.is_some());
    assert!(!folder.readonly);
}

#[test]
fn stat_reports_a_symlink_as_itself_and_a_missing_path_as_not_found() {
    let dir = temp_dir();
    assert_eq!(
        code(stat(&dir.join("missing")).unwrap_err()),
        ErrorCode::NotFound
    );
    #[cfg(unix)]
    {
        let link = dir.join("link");
        std::os::unix::fs::symlink(dir.join("b.txt"), &link).unwrap();
        let link_stat = stat(&link).unwrap();
        assert_eq!(
            (link_stat.kind, link_stat.size, link_stat.modified),
            (EntryKind::Symlink, None, None)
        );
        let dangling = dir.join("dangling");
        std::os::unix::fs::symlink(dir.join("missing"), &dangling).unwrap();
        assert_eq!(stat(&dangling).unwrap().kind, EntryKind::Symlink);
    }
}

#[test]
fn mkdir_creates_one_folder_and_refuses_what_exists() {
    let dir = temp_dir();
    let new = dir.join("new");
    assert_eq!(mkdir(&new, false).unwrap(), vec![new.clone()]);
    assert!(new.is_dir());

    for parents in [false, true] {
        let err = mkdir(&new, parents).unwrap_err();
        assert_eq!(code(err), ErrorCode::AlreadyExists, "parents: {parents}");
        let err = mkdir(&dir.join("b.txt"), parents).unwrap_err();
        assert_eq!(code(err), ErrorCode::AlreadyExists, "parents: {parents}");
    }
    assert_eq!(fs::read(dir.join("b.txt")).unwrap(), b"hello");

    let deep = dir.join("x").join("y");
    assert_eq!(code(mkdir(&deep, false).unwrap_err()), ErrorCode::NotFound);
    assert!(fs::symlink_metadata(dir.join("x")).is_err());
    assert_eq!(names(&dir), ["b.txt", "new", "sub"]);
}

#[test]
fn mkdir_with_parents_returns_the_folders_it_created_outermost_first() {
    let dir = temp_dir();
    let x = dir.join("x");
    let z = x.join("y").join("z");
    assert_eq!(
        mkdir(&z, true).unwrap(),
        vec![x.clone(), x.join("y"), z.clone()]
    );
    assert!(x.is_dir() && x.join("y").is_dir() && z.is_dir());

    // Folders that were there already are not in the list.
    let q = dir.join("sub").join("p").join("q");
    assert_eq!(
        mkdir(&q, true).unwrap(),
        vec![dir.join("sub").join("p"), q.clone()]
    );
}

#[test]
fn rename_renames_and_moves_files_and_folders() {
    let dir = temp_dir();
    rename(&dir.join("b.txt"), &dir.join("c.txt")).unwrap();
    assert_eq!(fs::read(dir.join("c.txt")).unwrap(), b"hello");
    assert!(fs::symlink_metadata(dir.join("b.txt")).is_err());

    let moved = dir.join("sub").join("c.txt");
    rename(&dir.join("c.txt"), &moved).unwrap();
    assert_eq!(fs::read(&moved).unwrap(), b"hello");
    assert!(fs::symlink_metadata(dir.join("c.txt")).is_err());

    fs::create_dir(dir.join("other")).unwrap();
    let folder = dir.join("other").join("sub");
    rename(&dir.join("sub"), &folder).unwrap();
    assert_eq!(fs::read(folder.join("c.txt")).unwrap(), b"hello");
    assert!(fs::symlink_metadata(dir.join("sub")).is_err());
    assert_eq!(names(&dir), ["other"]);
}

#[test]
fn rename_refuses_an_existing_target_a_missing_source_and_a_folder_into_itself() {
    let dir = temp_dir();
    fs::write(dir.join("c.txt"), "other").unwrap();
    fs::write(dir.join("sub").join("inner.txt"), "in").unwrap();
    fs::create_dir(dir.join("sub").join("deeper")).unwrap();
    // An empty folder, which a plain OS rename of a folder would replace.
    fs::create_dir(dir.join("empty")).unwrap();

    let refused = [
        (dir.join("b.txt"), dir.join("c.txt")),
        (dir.join("b.txt"), dir.join("empty")),
        (dir.join("sub"), dir.join("empty")),
        (dir.join("sub"), dir.join("c.txt")),
    ];
    for (from, to) in &refused {
        let err = rename(from, to).unwrap_err();
        assert_eq!(code(err), ErrorCode::AlreadyExists, "{from:?} to {to:?}");
    }
    assert_eq!(fs::read(dir.join("b.txt")).unwrap(), b"hello");
    assert_eq!(fs::read(dir.join("c.txt")).unwrap(), b"other");
    assert!(names(&dir.join("empty")).is_empty());

    let err = rename(&dir.join("missing"), &dir.join("d.txt")).unwrap_err();
    assert_eq!(code(err), ErrorCode::NotFound);

    for to in [
        dir.join("sub").join("moved"),
        dir.join("sub").join("deeper").join("sub"),
    ] {
        let err = rename(&dir.join("sub"), &to).unwrap_err();
        assert_eq!(code(err), ErrorCode::InvalidParams, "{to:?}");
    }
    assert_eq!(names(&dir), ["b.txt", "c.txt", "empty", "sub"]);
    assert_eq!(names(&dir.join("sub")), ["deeper", "inner.txt"]);
    assert!(names(&dir.join("sub").join("deeper")).is_empty());
}

#[test]
fn rename_changes_only_the_letter_case_of_a_name() {
    let dir = temp_dir();
    fs::write(dir.join("a.txt"), "case").unwrap();
    rename(&dir.join("a.txt"), &dir.join("A.txt")).unwrap();
    let listed = names(&dir);
    assert!(listed.contains(&"A.txt".to_owned()), "{listed:?}");
    assert!(!listed.contains(&"a.txt".to_owned()), "{listed:?}");
    assert_eq!(fs::read(dir.join("A.txt")).unwrap(), b"case");
}

#[test]
fn copy_copies_a_file_with_its_permissions_and_returns_its_size() {
    let dir = temp_dir();
    let source = dir.join("b.txt");
    assert_eq!(copy(&source, &dir.join("c.txt")).unwrap(), 5);
    assert_eq!(fs::read(dir.join("c.txt")).unwrap(), b"hello");
    assert!(!is_readonly(&dir.join("c.txt")));

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&source, fs::Permissions::from_mode(0o640)).unwrap();
        copy(&source, &dir.join("d.txt")).unwrap();
        let mode = fs::metadata(dir.join("d.txt"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o640);
    }

    make_readonly(&source);
    let copied = dir.join("sub").join("b.txt");
    assert_eq!(copy(&source, &copied).unwrap(), 5);
    assert_eq!(fs::read(&copied).unwrap(), b"hello");
    assert!(
        is_readonly(&copied),
        "a read-only source gives a read-only copy"
    );
    assert_eq!(fs::read(&source).unwrap(), b"hello");
    assert!(is_readonly(&source));
}

#[test]
fn copy_copies_a_folder_tree_and_leaves_no_temp_files() {
    let dir = temp_dir();
    let tree = dir.join("tree");
    fs::create_dir_all(tree.join("a").join("b")).unwrap();
    fs::create_dir(tree.join("empty")).unwrap();
    fs::write(tree.join("top.txt"), "top").unwrap();
    fs::write(tree.join("a").join("mid.bin"), [1u8, 2, 3, 4]).unwrap();
    fs::write(tree.join("a").join("b").join("deep.txt"), "deeper").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir(tree.join("locked")).unwrap();
        fs::write(tree.join("locked").join("kept.txt"), "kept").unwrap();
        fs::set_permissions(tree.join("locked"), fs::Permissions::from_mode(0o555)).unwrap();
    }

    let target = dir.join("sub").join("tree copy");
    let expected_bytes = if cfg!(unix) { 3 + 4 + 6 + 4 } else { 3 + 4 + 6 };
    assert_eq!(copy(&tree, &target).unwrap(), expected_bytes);

    assert_eq!(names(&target), names(&tree));
    assert_eq!(names(&target.join("a")), ["b", "mid.bin"]);
    assert_eq!(names(&target.join("a").join("b")), ["deep.txt"]);
    assert!(names(&target.join("empty")).is_empty());
    assert_eq!(fs::read(target.join("top.txt")).unwrap(), b"top");
    assert_eq!(
        fs::read(target.join("a").join("mid.bin")).unwrap(),
        [1u8, 2, 3, 4]
    );
    assert_eq!(
        fs::read(target.join("a").join("b").join("deep.txt")).unwrap(),
        b"deeper"
    );
    assert_eq!(names(&dir.join("sub")), ["tree copy"]);
    assert_eq!(names(&dir), ["b.txt", "sub", "tree"]);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let locked = target.join("locked");
        assert_eq!(fs::read(locked.join("kept.txt")).unwrap(), b"kept");
        let mode = fs::metadata(&locked).unwrap().permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o555,
            "a folder gets its permissions after its contents"
        );
        for folder in [tree.join("locked"), locked] {
            fs::set_permissions(folder, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
}

#[test]
fn copy_refuses_an_existing_target_and_a_target_inside_the_source() {
    let dir = temp_dir();
    fs::write(dir.join("c.txt"), "other").unwrap();
    fs::write(dir.join("sub").join("inner.txt"), "in").unwrap();

    for (from, to) in [
        (dir.join("b.txt"), dir.join("c.txt")),
        (dir.join("b.txt"), dir.join("sub")),
        (dir.join("sub"), dir.join("sub")),
        (dir.join("sub"), dir.join("b.txt")),
    ] {
        let err = copy(&from, &to).unwrap_err();
        assert_eq!(code(err), ErrorCode::AlreadyExists, "{from:?} to {to:?}");
    }
    assert_eq!(fs::read(dir.join("c.txt")).unwrap(), b"other");

    for to in [
        dir.join("sub").join("copy"),
        dir.join("sub").join("deeper").join("copy"),
    ] {
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let err = copy(&dir.join("sub"), &to).unwrap_err();
        assert_eq!(code(err), ErrorCode::InvalidParams, "{to:?}");
    }

    let err = copy(&dir.join("missing"), &dir.join("d.txt")).unwrap_err();
    assert_eq!(code(err), ErrorCode::NotFound);

    assert_eq!(names(&dir), ["b.txt", "c.txt", "sub"]);
    assert_eq!(names(&dir.join("sub")), ["deeper", "inner.txt"]);
    assert!(names(&dir.join("sub").join("deeper")).is_empty());
}

#[cfg(unix)]
#[test]
fn copy_recreates_symlinks_without_following_them() {
    use std::os::unix::fs::symlink;
    let dir = temp_dir();
    let tree = dir.join("tree");
    fs::create_dir(&tree).unwrap();
    fs::write(tree.join("real.txt"), "real").unwrap();
    symlink("real.txt", tree.join("relative")).unwrap();
    symlink(dir.join("b.txt"), tree.join("absolute")).unwrap();
    symlink("missing", tree.join("dangling")).unwrap();
    symlink(dir.join("sub"), tree.join("folder")).unwrap();

    let target = dir.join("copy");
    assert_eq!(copy(&tree, &target).unwrap(), 4, "only real.txt's bytes");
    for name in ["relative", "absolute", "dangling", "folder"] {
        assert!(is_symlink(&target.join(name)), "{name} is a link");
        assert_eq!(
            fs::read_link(target.join(name)).unwrap(),
            fs::read_link(tree.join(name)).unwrap()
        );
    }

    let top = dir.join("absolute copy");
    assert_eq!(copy(&tree.join("absolute"), &top).unwrap(), 0);
    assert!(is_symlink(&top));
    assert_eq!(fs::read_link(&top).unwrap(), dir.join("b.txt"));
    assert_eq!(
        names(&dir),
        ["absolute copy", "b.txt", "copy", "sub", "tree"]
    );
}

#[cfg(unix)]
#[test]
fn copy_that_fails_leaves_nothing_behind() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir();
    let tree = dir.join("tree");
    fs::create_dir_all(tree.join("a")).unwrap();
    fs::write(tree.join("a").join("ok.txt"), "ok").unwrap();
    fs::write(tree.join("top.txt"), "top").unwrap();
    let locked = tree.join("a").join("locked.txt");
    fs::write(&locked, "secret").unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read(&locked).is_ok() {
        // Root reads any file, so there is nothing to fail on.
        return;
    }

    let target = dir.join("sub").join("copy");
    let err = copy(&tree, &target).unwrap_err();
    assert_eq!(code(err), ErrorCode::IoError);
    assert!(fs::symlink_metadata(&target).is_err());
    assert!(names(&dir.join("sub")).is_empty(), "no .desk- temp entry");
    assert_eq!(names(&dir), ["b.txt", "sub", "tree"]);
}
