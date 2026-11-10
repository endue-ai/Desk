//! What each layout takes and refuses before anything changes (ADR 0147): the app inside an
//! `.app.tar.gz`, an AppImage, the Windows installers; how a running desk finds its layout and the
//! targets it updates as; the restart starting detached.

mod support;

use std::fs;
use std::path::Path;

use desk_update::install::{Layout, Running, install};
use support::bundle::{Entry, ID, app_tar_gz, chosen, info_plist, installed, names, tar_gz};
use support::dir;

const APP: &str = "darwin-aarch64-app";

fn refused(layout: &Layout, target: &str, file: &str, bytes: &[u8], scratch: &Path) -> String {
    install(
        layout,
        &chosen("0.6.0", target, file, bytes),
        bytes,
        scratch,
    )
    .unwrap_err()
}

#[test]
fn an_archive_that_is_not_this_desk_whole_is_refused_and_nothing_moves() {
    let root = dir("packages-app");
    let apps = root.join("Applications");
    let app = installed(&apps, "endue-desk-cef", "0.5.0");
    let layout = Layout::App { app: app.clone() };
    let whole = app_tar_gz("endue-desk-cef", ID, "0.6.0");
    let cases: Vec<(Vec<u8>, &str)> = vec![
        (b"PK\x03\x04 a zip".to_vec(), "is not an .app.tar.gz"),
        (whole[..whole.len() * 2 / 3].to_vec(), "did not unpack"),
        (
            app_tar_gz("endue-desk-cef", "ai.other.app", "x"),
            "not this desk (ai.endue.desk)",
        ),
        (
            tar_gz(&[Entry("README", b"no app".to_vec(), 0o644)]),
            "holds no app",
        ),
        (
            tar_gz(&[Entry(
                "endue Desk.app/Contents/Info.plist",
                info_plist("endue-desk-cef", ID).into_bytes(),
                0o644,
            )]),
            "no executable endue-desk-cef",
        ),
    ];
    for (bytes, says) in cases {
        let why = refused(&layout, APP, "desk.app.tar.gz", &bytes, &root);
        assert!(why.contains(says), "{why} does not say {says}");
        assert_eq!(names(&apps), ["endue Desk.app"], "after: {says}");
        let program = app.join("Contents/MacOS/endue-desk-cef");
        assert_eq!(fs::read_to_string(program).unwrap(), "0.5.0");
    }
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn an_appimage_is_renamed_over_the_installed_one_and_keeps_its_mode() {
    use std::os::unix::fs::PermissionsExt;
    let root = dir("packages-appimage");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("endue-desk.AppImage");
    fs::write(&file, b"\x7fELF 0.5.0").unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o750)).unwrap();
    let layout = Layout::AppImage { file: file.clone() };
    let target = "linux-x86_64-appimage";
    let why = refused(&layout, target, "d.AppImage", b"#!/bin/sh", &root);
    assert!(why.contains("is not an AppImage"), "{why}");
    let bytes = b"\x7fELF 0.6.0".to_vec();
    let relaunch = install(
        &layout,
        &chosen("0.6.0", target, "d.AppImage", &bytes),
        &bytes,
        &root,
    );
    assert_eq!(relaunch.unwrap().program, file);
    assert_eq!(fs::read(&file).unwrap(), bytes);
    let mode = fs::metadata(&file).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o750);
    assert_eq!(names(&root), ["endue-desk.AppImage"]);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_windows_installer_waits_in_the_updates_folder_for_the_desk_to_quit() {
    let root = dir("packages-windows");
    let folder = root.join("endue Desk");
    fs::create_dir_all(&folder).unwrap();
    let exe = folder.join("endue-desk-cef.exe");
    let layout = Layout::Nsis { exe: exe.clone() };
    let scratch = root.join("updates");
    let msi = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0];
    let why = refused(&layout, "windows-x86_64-nsis", "s.exe", &msi, &scratch);
    assert!(why.contains("is not an NSIS installer"), "{why}");
    let setup = b"MZ setup".to_vec();
    let staged = chosen("0.6.0", "windows-x86_64-nsis", "s-setup.exe", &setup);
    let relaunch = install(&layout, &staged, &setup, &scratch).unwrap();
    assert!(relaunch.program.ends_with("powershell.exe"), "{relaunch:?}");
    assert_eq!(relaunch.args[4], "-EncodedCommand");
    assert_eq!(fs::read(scratch.join("0.6.0/install.exe")).unwrap(), setup);
    assert!(
        fs::read(&exe).is_err(),
        "the desk itself is not touched before it quits"
    );
    let msi_layout = Layout::Msi { exe };
    let why = refused(&msi_layout, "windows-x86_64-msi", "d.msi", &setup, &scratch);
    assert!(why.contains("is not an MSI"), "{why}");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn a_running_desk_knows_its_layout_and_the_targets_it_updates_as() {
    let mac = Path::new("/Applications/endue Desk.app/Contents/MacOS/endue-desk-cef");
    let app = Layout::of("macos", &Running::at(mac));
    assert_eq!(
        app,
        Some(Layout::App {
            app: "/Applications/endue Desk.app".into()
        })
    );
    let dev = Path::new("/repo/target/release/endue-desk-cef");
    assert_eq!(Layout::of("macos", &Running::at(dev)), None);
    let image = Path::new("/home/a/Apps/endue.AppImage");
    let mounted = Path::new("/tmp/.mount_x/usr/lib/endue-desk-cef/endue-desk-cef");
    let running = Running {
        appimage: Some(image),
        ..Running::at(mounted)
    };
    assert_eq!(
        Layout::of("linux", &running),
        Some(Layout::AppImage { file: image.into() })
    );
    let deb = Path::new("/usr/lib/endue-desk-cef/endue-desk-cef");
    let deb = Layout::of("linux", &Running::at(deb)).unwrap();
    assert_eq!(deb.targets("linux-x86_64"), ["linux-x86_64-deb"]);
    assert_eq!(
        app.unwrap().targets("darwin-aarch64"),
        [APP, "darwin-aarch64"]
    );
    // Windows: NSIS leaves its uninstaller beside the desk; an MSI installs under Program Files.
    let root = dir("packages-layout");
    let nsis = root.join("Local/endue Desk/endue-desk-cef.exe");
    fs::create_dir_all(nsis.parent().unwrap()).unwrap();
    fs::write(nsis.with_file_name("uninstall.exe"), b"MZ").unwrap();
    let pf = root.join("Program Files");
    let msi = pf.join("endue Desk/endue-desk-cef.exe");
    let on = |exe: &Path| {
        let running = Running {
            program_files: Some(&pf),
            ..Running::at(exe)
        };
        Layout::of("windows", &running)
    };
    let nsis = on(&nsis).unwrap();
    assert_eq!(
        nsis.targets("windows-x86_64"),
        ["windows-x86_64-nsis", "windows-x86_64"]
    );
    assert_eq!(
        on(&msi).unwrap().targets("windows-x86_64"),
        ["windows-x86_64-msi"]
    );
    assert_eq!(on(&root.join("target/debug/endue-desk-cef.exe")), None);
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn the_restart_starts_detached_with_its_output_in_a_file() {
    use desk_update::install::Relaunch;
    let root = dir("packages-relaunch");
    fs::create_dir_all(&root).unwrap();
    let log = root.join("restart.log");
    let started = Relaunch::new("/bin/sh".into(), vec!["-c".into(), "echo started".into()]);
    let status = started.spawn(Some(&log)).unwrap().wait().unwrap();
    assert!(status.success());
    assert_eq!(fs::read_to_string(&log).unwrap(), "started\n");
    let _ = fs::remove_dir_all(root);
}
