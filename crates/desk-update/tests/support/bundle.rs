//! App bundles and their `.app.tar.gz` for the installer tests, made at test time.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use desk_update::Chosen;
use desk_update::verify::sha256_hex;
use flate2::Compression;
use flate2::write::GzEncoder;

pub const ID: &str = "ai.endue.desk";

/// An Info.plist naming `executable` and `id`.
pub fn info_plist(executable: &str, id: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>{executable}</string>
<key>CFBundleIdentifier</key><string>{id}</string>
</dict></plist>
"#
    )
}

/// An installed app at `<dir>/endue Desk.app` whose executable `executable` prints `marker`.
pub fn installed(dir: &Path, executable: &str, marker: &str) -> PathBuf {
    let app = dir.join("endue Desk.app");
    let contents = app.join("Contents");
    fs::create_dir_all(contents.join("MacOS")).unwrap();
    fs::write(contents.join("Info.plist"), info_plist(executable, ID)).unwrap();
    let program = contents.join("MacOS").join(executable);
    fs::write(&program, marker).unwrap();
    executable_mode(&program);
    app
}

#[cfg(unix)]
fn executable_mode(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

#[cfg(not(unix))]
fn executable_mode(_path: &Path) {}

/// One file of an archive: its path, bytes and mode.
pub struct Entry<'a>(pub &'a str, pub Vec<u8>, pub u32);

/// A gzipped tar of `entries`, as `tar -czf` writes one.
pub fn tar_gz(entries: &[Entry]) -> Vec<u8> {
    let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
    for Entry(path, bytes, mode) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(*mode);
        header.set_mtime(1_700_000_000);
        header.set_cksum();
        builder
            .append_data(&mut header, path, bytes.as_slice())
            .unwrap();
    }
    let mut gz = builder.into_inner().unwrap();
    gz.flush().unwrap();
    gz.finish().unwrap()
}

/// The `.app.tar.gz` of an `endue Desk.app` whose executable `executable` holds `marker`.
pub fn app_tar_gz(executable: &str, id: &str, marker: &str) -> Vec<u8> {
    tar_gz(&[
        Entry(
            "endue Desk.app/Contents/Info.plist",
            info_plist(executable, id).into_bytes(),
            0o644,
        ),
        Entry(
            &format!("endue Desk.app/Contents/MacOS/{executable}"),
            marker.as_bytes().to_vec(),
            0o755,
        ),
        Entry(
            "endue Desk.app/Contents/Frameworks/Chromium Embedded Framework.framework/Resources/icudtl.dat",
            b"icu".to_vec(),
            0o644,
        ),
    ])
}

/// What the updater would hand the installer for `bytes` as `version` on `target`.
pub fn chosen(version: &str, target: &str, file: &str, bytes: &[u8]) -> Chosen {
    Chosen {
        version: version.to_owned(),
        commit: Some("c46d12b".to_owned()),
        date: None,
        notes: None,
        target: target.to_owned(),
        url: format!("https://releases.example.test/desk/releases/{version}/{file}"),
        file: file.to_owned(),
        size: bytes.len() as u64,
        sha256: sha256_hex(bytes),
        signature: "sig".to_owned(),
        release: format!("https://releases.example.test/desk/releases/{version}/release.json"),
    }
}

/// The names in `dir`, sorted.
pub fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}
