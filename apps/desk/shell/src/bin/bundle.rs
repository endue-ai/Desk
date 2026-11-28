//! Assembles `target/bundle/endue.app` on macOS from binaries already built
//! (`cargo build -p desk-shell --bins [--release]`): the CEF framework, the five helper apps, the
//! app icon (`icons/icon.icns`) and the built shell (`apps/desk/dist`) in
//! `Contents/Resources/shell`, and a link to the repository's `plugins/` in
//! `Contents/Resources/plugins`, so the app opened by itself (Finder, `open`) has its built-in
//! plugins as a package does. `just dev` runs it.
//! usage: desk-shell-bundle [out-dir] [debug|release]

#[cfg(target_os = "macos")]
fn main() -> std::process::ExitCode {
    match build() {
        Ok(app) => {
            println!("{}", app.display());
            std::process::ExitCode::SUCCESS
        }
        Err(why) => {
            eprintln!("desk-shell-bundle: {why}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    product_name: String,
    identifier: String,
}

#[cfg(target_os = "macos")]
fn build() -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    use cef::build_util::mac::{BundleInfo, bundle};
    use std::{fs, path::PathBuf};

    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "target/bundle".into()),
    );
    let profile = std::env::args().nth(2).unwrap_or_else(|| "debug".into());
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()?;
    let target = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace.join("target"))
        .join(profile);
    let product: Product = serde_json::from_str(include_str!("../../packager/packager.json"))?;
    fs::create_dir_all(&out)?;
    let build = tempfile::Builder::new()
        .prefix(".endue-build-")
        .tempdir_in(&out)?;
    let app_name = format!("{}.app", product.product_name);
    let destination = out.join(&app_name);
    let info = BundleInfo::new(
        &product.product_name,
        &product.identifier,
        &product.product_name,
        "English",
        semver::Version::new(0, 0, 0),
    );
    // CEF derives its staging filename and all five helper names from the executable.
    let staged = bundle(
        build.path(),
        &target,
        "endue-desk",
        "endue-desk-helper",
        Some(icon_resources(build.path())?),
        info,
    )?;
    let resources = staged.join("Contents/Resources");
    let dist = workspace.join("apps/desk/dist");
    if dist.join("index.html").is_file() {
        copy_dir(&dist, &resources.join("shell"))?;
    }
    // Resolve the live plugins relative to the bundle's final location.
    let final_resources = out
        .canonicalize()?
        .join(app_name)
        .join("Contents/Resources");
    let plugins = workspace.join("plugins");
    let common = final_resources
        .ancestors()
        .find(|ancestor| plugins.starts_with(ancestor))
        .ok_or("cannot locate the plugins relative to the app")?;
    let parents: PathBuf = final_resources
        .strip_prefix(common)?
        .components()
        .map(|_| "..")
        .collect();
    std::os::unix::fs::symlink(
        parents.join(plugins.strip_prefix(common)?),
        resources.join("plugins"),
    )?;
    publish(&out, &staged, &destination, &product.identifier)?;
    Ok(destination)
}

#[cfg(target_os = "macos")]
fn publish(
    out: &std::path::Path,
    staged: &std::path::Path,
    destination: &std::path::Path,
    identifier: &str,
) -> std::io::Result<()> {
    use rustix::fs::{CWD, RenameFlags, renameat_with};
    use std::{fs, io};

    let directory = fs::File::open(out)?;
    directory.lock()?;
    let flags = match fs::symlink_metadata(destination) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => RenameFlags::NOREPLACE,
        Err(e) => return Err(e),
        Ok(metadata) if metadata.is_dir() && development_bundle(destination, identifier) => {
            RenameFlags::EXCHANGE
        }
        Ok(_) => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "another app occupies the build destination",
            ));
        }
    };
    // A running app keeps its executable. The previous bundle goes away with the staging directory.
    renameat_with(CWD, staged, CWD, destination, flags)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn development_bundle(path: &std::path::Path, identifier: &str) -> bool {
    if !path.join("Contents/Resources/plugins").is_symlink() {
        return false;
    }
    let info = plist::Value::from_file(path.join("Contents/Info.plist")).ok();
    let dict = info.as_ref().and_then(plist::Value::as_dictionary);
    let field = |key: &str| dict?.get(key)?.as_string();
    field("CFBundleIdentifier") == Some(identifier)
        && field("CFBundleExecutable") == Some("endue-desk")
}

/// The app icon (`apps/desk/shell/icons/icon.icns`, `just app-icons`) where cef's bundler looks for
/// it: `<resources>/mac/endue-desk.icns`, which it copies into Contents/Resources and names in the
/// Info.plist.
#[cfg(target_os = "macos")]
fn icon_resources(out: &std::path::Path) -> std::io::Result<std::path::PathBuf> {
    let resources = out.join("endue-desk.resources");
    let mac = resources.join("mac");
    std::fs::create_dir_all(&mac)?;
    let icon = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/icon.icns");
    std::fs::copy(icon, mac.join("endue-desk.icns"))?;
    Ok(resources)
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use std::{fs, io, os::unix::fs::symlink};

    #[test]
    fn publishing_replaces_the_development_app_and_preserves_other_apps() {
        let out = tempfile::tempdir().unwrap();
        let destination = out.path().join("endue.app");
        let staged = out.path().join("staged.app");
        let identifier = "ai.endue.desktop";
        fs::create_dir_all(staged.join("Contents/Resources")).unwrap();
        fs::create_dir(out.path().join("plugins")).unwrap();
        symlink(
            "../../../plugins",
            staged.join("Contents/Resources/plugins"),
        )
        .unwrap();
        let mut info = plist::Dictionary::new();
        info.insert("CFBundleIdentifier".into(), identifier.into());
        info.insert("CFBundleExecutable".into(), "endue-desk".into());
        plist::to_file_xml(staged.join("Contents/Info.plist"), &info).unwrap();
        super::publish(out.path(), &staged, &destination, identifier).unwrap();

        fs::create_dir(&staged).unwrap();
        fs::write(staged.join("fixture"), b"endue").unwrap();
        super::publish(out.path(), &staged, &destination, identifier).unwrap();
        assert_eq!(fs::read(destination.join("fixture")).unwrap(), b"endue");
        assert!(staged.join("Contents/Info.plist").is_file());

        let error = super::publish(out.path(), &staged, &destination, identifier).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(destination.join("fixture")).unwrap(), b"endue");
    }
}
