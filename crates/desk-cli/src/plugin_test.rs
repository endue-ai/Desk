//! `desk plugin test <dir>`: a plugin's tests, on the host that matches its kind. Logic plugins
//! and Wasm connectors run each `tests/<name>.test.json` on the desk-plugin-host harness (a
//! scripted desk); every other kind runs `tests/*.test.{js,ts}` with vitest on the SDK's test host,
//! from the Desk checkout. Exit codes: 0 every test passed, 1 otherwise.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use desk_bridge::{ConnectorBinding, PluginKind, PluginManifest};
use desk_plugin_host::harness;

use crate::kind_name;

pub fn run(dir: &Path, manifest: &PluginManifest) -> ExitCode {
    let wasm_connector = manifest
        .connector
        .as_ref()
        .is_some_and(|connector| connector.binding == ConnectorBinding::Wasm);
    match manifest.kind {
        PluginKind::Logic => wasm(dir),
        PluginKind::Connector if wasm_connector => wasm(dir),
        PluginKind::Connector | PluginKind::Tool => fail(&format!(
            "{} is a {} plugin on MCP, which has no test host yet",
            manifest.id,
            kind_name(manifest.kind)
        )),
        _ => sdk(dir),
    }
}

fn fail(why: &str) -> ExitCode {
    eprintln!("desk plugin test: {why}");
    ExitCode::from(1)
}

/// Every JSON test on the harness: `ok <name>` or `FAILED <name>` (why on stderr), then a count.
fn wasm(dir: &Path) -> ExitCode {
    let ran = match harness::run_folder(dir) {
        Ok(ran) => ran,
        Err(why) => return fail(&why),
    };
    if ran.is_empty() {
        let tests = dir.join("tests");
        return fail(&format!(
            "no tests in {}: add <name>.test.json",
            tests.display()
        ));
    }
    let mut failed = 0;
    for (name, outcome) in &ran {
        match outcome {
            Ok(()) => println!("ok {name}"),
            Err(why) => {
                failed += 1;
                println!("FAILED {name}");
                eprintln!("{name}: {}", why.replace('\n', "\n  "));
            }
        }
    }
    println!("{} passed, {failed} failed", ran.len() - failed);
    if failed == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

/// The Desk checkout with the SDK and vitest: `DESK_REPO`, or the one this binary was built from.
fn repo() -> PathBuf {
    std::env::var_os("DESK_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

/// vitest on the SDK's test host (`packages/plugin-sdk/vitest.plugin.config.ts`): the plugin's
/// folder as the root, `@endue-ai/plugin-sdk` and its `testing` resolved in the checkout, jsdom.
fn sdk(dir: &Path) -> ExitCode {
    let repo = repo();
    let vitest = repo.join("node_modules/vitest/vitest.mjs");
    let config = repo.join("packages/plugin-sdk/vitest.plugin.config.ts");
    if !vitest.is_file() || !config.is_file() {
        return fail(&format!(
            "the SDK's test host is not in {}: set DESK_REPO to a Desk checkout where `pnpm install` ran",
            repo.display()
        ));
    }
    let dir = match std::path::absolute(dir) {
        Ok(dir) => dir,
        Err(why) => return fail(&format!("{}: {why}", dir.display())),
    };
    let status = Command::new("node")
        .arg(&vitest)
        .arg("run")
        .arg("--config")
        .arg(&config)
        .env("DESK_PLUGIN_DIR", &dir)
        .current_dir(&repo)
        .status();
    match status {
        Ok(status) if status.success() => ExitCode::SUCCESS,
        Ok(_) => ExitCode::from(1),
        Err(why) => fail(&format!("node did not run vitest: {why}")),
    }
}
