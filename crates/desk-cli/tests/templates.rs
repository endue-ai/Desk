//! The plugin templates, end to end, as CI runs them in `just test-unit`: `create-plugin` scaffolds
//! every kind into a temporary folder, the Wasm kinds build with `cargo build --release` for
//! wasm32-wasip2 as their READMEs say, and `desk plugin validate` and `desk plugin test` pass on
//! each. The examples pass `desk plugin test` too.
//!
//! Needs `node` with the workspace's packages installed (`pnpm install`). Outside CI, the Wasm kinds
//! are skipped with a note when the pinned toolchain lacks the wasm32-wasip2 target, which
//! `rust-toolchain.toml` lists; in CI (`CI` set) that fails instead.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::OnceLock;

use serde_json::Value;

const KINDS: [&str; 5] = ["ui", "logic", "connector", "view", "policy"];
const WASM: [&str; 2] = ["logic", "connector"];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

/// Where this binary keeps what it builds: target/tmp, which cargo keeps between runs.
fn scratch() -> PathBuf {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn run(command: &mut Command) -> Output {
    let out = command.output().expect("the command runs");
    assert!(
        out.status.success(),
        "{command:?}\n{}\n{}",
        text(&out.stdout),
        text(&out.stderr)
    );
    out
}

fn desk(args: &[&str]) -> Output {
    run(Command::new(env!("CARGO_BIN_EXE_desk")).args(args))
}

/// The create-plugin command, built once from packages/create-plugin with its own vite.
fn create_plugin() -> &'static Path {
    static BUILT: OnceLock<PathBuf> = OnceLock::new();
    BUILT.get_or_init(|| {
        let package = repo().join("packages/create-plugin");
        let out = scratch().join("create-plugin");
        run(Command::new("node")
            .arg(package.join("node_modules/vite/bin/vite.js"))
            .args(["build", "--logLevel", "warn", "--outDir"])
            .arg(&out)
            .current_dir(&package));
        out.join("create-plugin.js")
    })
}

/// The toolchain `rust-toolchain.toml` pins, for builds outside the repository.
fn toolchain() -> String {
    let file = fs::read_to_string(repo().join("rust-toolchain.toml")).unwrap();
    let line = file.lines().find(|l| l.starts_with("channel")).unwrap();
    line.split('"').nth(1).unwrap().to_owned()
}

/// Whether the pinned toolchain can build for wasm32-wasip2.
fn wasm_target() -> bool {
    let out = run(Command::new("rustc")
        .args(["--print", "sysroot"])
        .env("RUSTUP_TOOLCHAIN", toolchain()));
    let sysroot = PathBuf::from(text(&out.stdout).trim());
    sysroot.join("lib/rustlib/wasm32-wasip2").is_dir()
}

/// `create-plugin <dir> --kind <kind>` into a fresh folder named after the kind.
fn scaffold(root: &Path, kind: &str) -> PathBuf {
    let dir = root.join(format!("my-{kind}"));
    run(Command::new("node")
        .arg(create_plugin())
        .arg(&dir)
        .args(["--kind", kind]));
    dir
}

/// `cargo build --release` in the folder, as its README says, on the pinned toolchain. Both kinds
/// share one target folder so wit-bindgen builds once; the component is copied where the entry is.
fn build(dir: &Path) {
    let target = scratch().join("plugin-templates");
    run(Command::new("cargo")
        .args(["build", "--release", "--quiet"])
        .current_dir(dir)
        .env("RUSTUP_TOOLCHAIN", toolchain())
        .env("CARGO_TARGET_DIR", &target));
    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(dir.join("plugin.json")).unwrap()).unwrap();
    let entry = dir.join(manifest["entry"].as_str().unwrap());
    let built = target
        .join("wasm32-wasip2/release")
        .join(entry.file_name().unwrap());
    fs::create_dir_all(entry.parent().unwrap()).unwrap();
    fs::copy(built, entry).unwrap();
}

#[test]
fn every_kind_scaffolds_validates_and_passes_its_test() {
    let root = scratch().join(format!("templates-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let wasm = wasm_target();
    assert!(
        wasm || std::env::var_os("CI").is_none(),
        "the toolchain lacks wasm32-wasip2: `rustup toolchain install` adds what rust-toolchain.toml lists"
    );
    for kind in KINDS {
        if WASM.contains(&kind) && !wasm {
            eprintln!("note: {kind} skipped: `rustup target add wasm32-wasip2` to build it");
            continue;
        }
        let dir = scaffold(&root, kind);
        if WASM.contains(&kind) {
            build(&dir);
        }
        let folder = dir.to_str().unwrap();
        let validated = text(&desk(&["plugin", "validate", folder]).stdout);
        assert_eq!(
            validated,
            format!("ok local.my-{kind} 0.1.0 ({kind} plugin)\n")
        );
        desk(&["plugin", "test", folder]);
    }
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_examples_pass_their_tests() {
    for example in ["ui", "view", "wasm", "connector"] {
        let dir = repo().join(format!("examples/plugin-hello-{example}"));
        desk(&["plugin", "test", dir.to_str().unwrap()]);
    }
}
