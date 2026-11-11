//! `desk`: the command line for people and AI agents. Exit codes: 0 ok, 1 check or call failed, 2
//! usage. `plugin validate`, `plugin test`, `doctor`, `doctor --trace`, `export` and `import` work
//! offline; the other subcommands reach a running desk over its socket, `mcp` for another app (ADR
//! 0086).

mod args;
mod doctor;
mod export;
mod files;
mod health;
mod lock;
mod plugin_test;
mod remote;
mod theme;
mod undo;
mod usage;

use std::path::Path;
use std::process::ExitCode;

use desk_bridge::{PluginKind, PluginManifest};
use serde_json::json;

use crate::args::Action;
use crate::usage::USAGE;

fn main() -> ExitCode {
    let args = match args::parse(std::env::args().skip(1).collect()) {
        Ok(args) => args,
        Err(wrong) => {
            eprint!("{}", usage::wrong(&wrong));
            return ExitCode::from(2);
        }
    };
    match args.action {
        Action::Help => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Action::Validate(dir) => validate(&dir, args.json),
        // Tests run on a plugin that validates; one that does not says why, as validate does.
        Action::Test(dir) => match checked(&dir) {
            Ok(manifest) => plugin_test::run(&dir, &manifest),
            Err(problems) => report(&dir, problems),
        },
        Action::Trace(file) => doctor::trace(&file, args.json),
        Action::Doctor(data) => health::run(data, args.json),
        Action::Lock => lock::list(args.json),
        Action::Export {
            target,
            with_data,
            data,
        } => export::export(&target, with_data, data),
        Action::Import {
            source,
            with_data,
            data,
        } => export::import(&source, with_data, data),
        Action::LastCrash(data) => health::last_crash(data, args.json),
        Action::Remote(remote) => remote::run(remote, args.json),
        Action::Mcp { agent, plugins } => mcp(agent, plugins),
    }
}

/// `desk mcp`: serve the running desk to another app over MCP until it closes stdin (ADR 0086).
/// Only MCP goes to stdout; what goes wrong goes to stderr.
fn mcp(agent: Option<String>, plugins: Vec<String>) -> ExitCode {
    let defaults = desk_mcp::Options::default();
    let options = desk_mcp::Options {
        agent: agent.unwrap_or(defaults.agent),
        plugins,
        ..defaults
    };
    match desk_mcp::serve(std::io::stdin().lock(), std::io::stdout(), options) {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("desk: mcp: {why}");
            ExitCode::from(1)
        }
    }
}

/// `plugin validate`: `ok <id> <version> (<kind> plugin)`, or every problem on stderr; with `--json`
/// one line on stdout either way, `{ ok: true, id, version, kind }` or `{ ok: false, problems }`.
fn validate(dir: &Path, json: bool) -> ExitCode {
    match checked(dir) {
        Ok(manifest) => {
            let kind = kind_name(manifest.kind);
            if json {
                let answer = json!({ "ok": true, "id": manifest.id, "version": manifest.version, "kind": kind });
                println!("{answer}");
            } else {
                println!("ok {} {} ({kind} plugin)", manifest.id, manifest.version);
            }
            ExitCode::SUCCESS
        }
        Err(problems) if json => {
            println!("{}", json!({ "ok": false, "problems": problems }));
            ExitCode::from(1)
        }
        Err(problems) => report(dir, problems),
    }
}

/// The kind as plugin.json writes it.
fn kind_name(kind: PluginKind) -> &'static str {
    match kind {
        PluginKind::Ui => "ui",
        PluginKind::Logic => "logic",
        PluginKind::Tool => "tool",
        PluginKind::Policy => "policy",
        PluginKind::Library => "library",
        PluginKind::Connector => "connector",
        PluginKind::View => "view",
        PluginKind::Pack => "pack",
        PluginKind::Theme => "theme",
        PluginKind::DesignSystem => "design-system",
        PluginKind::Native => "native",
    }
}

/// The manifest of the plugin in `dir` when it passes every check, or every problem.
fn checked(dir: &Path) -> Result<PluginManifest, Vec<String>> {
    desk_core::validate_dir(dir).and_then(|manifest| {
        let problems = beyond_the_schema(dir, &manifest);
        if problems.is_empty() {
            Ok(manifest)
        } else {
            Err(problems)
        }
    })
}

fn report(dir: &Path, problems: Vec<String>) -> ExitCode {
    eprintln!("{}: {} problem(s)", dir.display(), problems.len());
    for problem in problems {
        eprintln!("  - {problem}");
    }
    ExitCode::from(1)
}

/// What the schema cannot check: the names an inline view and a connector's actions use resolve
/// (`desk_bridge::manifest_problems`), and every view file exists. The schema keeps view file paths
/// inside the folder.
fn beyond_the_schema(dir: &Path, manifest: &PluginManifest) -> Vec<String> {
    let mut problems: Vec<String> = desk_bridge::manifest_problems(manifest)
        .into_iter()
        .map(|problem| format!("plugin.json{problem}"))
        .collect();
    for file in manifest.views.iter().flatten() {
        if !dir.join(file).is_file() {
            problems.push(format!("plugin.json: view file {file} does not exist"));
        }
    }
    problems
}
