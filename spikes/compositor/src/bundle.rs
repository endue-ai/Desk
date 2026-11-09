//! Builds `target/bundle/desk-spike.app` with the CEF framework and the helper apps (macOS).

#[cfg(target_os = "macos")]
fn main() {
    use cef::build_util::mac::{BundleInfo, build_bundle};
    let out = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "target/bundle".into()),
    );
    std::fs::create_dir_all(&out).unwrap();
    let info = BundleInfo::new(
        "desk-spike",
        "ai.endue.desk.spike",
        "Desk Spike",
        "English",
        semver::Version::new(0, 0, 0),
    );
    let path = build_bundle(&out, "desk-spike", info).expect("the bundle builds");
    println!("{}", path.display());
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("on Linux and Windows run target/debug/desk-spike directly");
}
