//! Assembles `target/bundle/endue-desk.app` on macOS from binaries already built
//! (`cargo build -p desk-shell --bins [--release]`): the CEF framework, the five helper apps and
//! the built shell (`apps/desk/dist`) in `Contents/Resources/shell`. `just dev` runs it.
//! usage: desk-shell-bundle [out-dir] [debug|release]

#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    use cef::build_util::mac::{BundleInfo, bundle};
    let out = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "target/bundle".into()),
    );
    let profile = std::env::args().nth(2).unwrap_or_else(|| "debug".into());
    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| workspace.join("target"))
        .join(&profile);
    if let Err(why) = std::fs::create_dir_all(&out) {
        eprintln!("desk-shell-bundle: {why}");
        return std::process::ExitCode::FAILURE;
    }
    let info = BundleInfo::new(
        "endue-desk",
        "ai.endue.desk",
        "endue Desk",
        "English",
        semver::Version::new(0, 0, 0),
    );
    let app = match bundle(&out, &target, "endue-desk", "endue-desk-helper", None, info) {
        Ok(app) => app,
        Err(why) => {
            eprintln!("desk-shell-bundle: {why}");
            return std::process::ExitCode::FAILURE;
        }
    };
    let dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist");
    let shell = app.join("Contents/Resources/shell");
    let _ = std::fs::remove_dir_all(&shell);
    if dist.join("index.html").is_file()
        && let Err(why) = copy_dir(&dist, &shell)
    {
        eprintln!("desk-shell-bundle: the shell files did not copy ({why})");
        return std::process::ExitCode::FAILURE;
    }
    println!("{}", app.display());
    std::process::ExitCode::SUCCESS
}

#[cfg(target_os = "macos")]
fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("desk-shell-bundle: macOS only; on Linux and Windows run target/debug/endue-desk");
}
