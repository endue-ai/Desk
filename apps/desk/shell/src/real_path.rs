//! The name the desk gives a file, so one file is one buffer however its path was spelled (#162
//! finding 12): `~/files/a.csv` from the Explorer, `/Users/me/files/a.csv` from a drop and
//! `/private/tmp/a.csv` for `/tmp/a.csv` are each one file. The page asks with `real_path`; the
//! folders above the file are followed through their links, the home folder is `~`, and the file
//! itself is never followed, so a link keeps its own name. Nothing is read or opened.

use std::path::{Path, PathBuf};

/// `path`, a bridge path (`~/…` or absolute), as the desk names the file: the folders above it
/// followed through their links, inside `home` as `~/…`, with forward slashes. A path the OS cannot
/// follow (its folder is missing, say) comes back as it was given.
pub fn real_path(path: &str, home: &Path) -> String {
    let local = match path.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with('/') => home.join(&rest[1..]),
        Some(_) => return path.to_owned(),
        None => PathBuf::from(path),
    };
    let (Some(folder), Some(name)) = (local.parent(), local.file_name()) else {
        return path.to_owned();
    };
    if !local.is_absolute() {
        return path.to_owned();
    }
    let Ok(folder) = std::fs::canonicalize(folder) else {
        return path.to_owned();
    };
    let real = plain(folder).join(name);
    let home = std::fs::canonicalize(home).map_or_else(|_| home.to_path_buf(), plain);
    let slashes = |p: &Path| p.to_string_lossy().replace('\\', "/");
    match real.strip_prefix(&home) {
        Ok(rest) if !home.as_os_str().is_empty() => format!("~/{}", slashes(rest)),
        _ => slashes(&real),
    }
}

/// Windows answers a canonical path as `\\?\C:\…` (or `\\?\UNC\server\…`); the desk writes `C:/…`.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::real_path;
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;

    /// A folder of its own under the temp folder (itself a link on macOS: /tmp, /var).
    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("desk-real-path-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("home/files")).unwrap();
        fs::write(dir.join("home/files/small.csv"), "a,b\n").unwrap();
        symlink(dir.join("home/files"), dir.join("home/link")).unwrap();
        symlink(
            dir.join("home/files/small.csv"),
            dir.join("home/files/alias.csv"),
        )
        .unwrap();
        dir
    }

    #[test]
    fn every_spelling_of_one_file_has_one_name() {
        let dir = scratch("spellings");
        let home = dir.join("home");
        let absolute = home.join("files/small.csv");
        let real = fs::canonicalize(&absolute).unwrap();
        for path in [
            "~/files/small.csv".to_owned(),
            "~/link/small.csv".to_owned(),
            absolute.to_string_lossy().into_owned(),
            real.to_string_lossy().into_owned(),
        ] {
            assert_eq!(real_path(&path, &home), "~/files/small.csv", "{path}");
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_link_keeps_its_name_a_missing_folder_its_spelling_and_outside_home_stays_absolute() {
        let dir = scratch("names");
        let home = dir.join("home");
        assert_eq!(real_path("~/files/alias.csv", &home), "~/files/alias.csv");
        assert_eq!(real_path("~/gone/a.csv", &home), "~/gone/a.csv");
        assert_eq!(real_path("relative.csv", &home), "relative.csv");
        let linked = home.join("link/small.csv");
        let outside = real_path(&linked.to_string_lossy(), &dir.join("elsewhere"));
        assert!(outside.starts_with('/'), "{outside}");
        assert!(outside.ends_with("/home/files/small.csv"), "{outside}");
        assert!(!outside.contains("/home/link/"), "{outside}");
        fs::remove_dir_all(dir).unwrap();
    }
}
