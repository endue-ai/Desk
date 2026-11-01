//! `desk`: the command line for people and AI agents. Exit codes: 0 ok, 1 check or call failed, 2
//! usage. `plugin validate` works offline; the other subcommands reach a running desk over its socket.

mod args;
mod remote;

use std::path::Path;
use std::process::ExitCode;

use desk_bridge::{PluginKind, PluginManifest};

use crate::args::{Action, USAGE};

fn main() -> ExitCode {
    let Some(args) = args::parse(std::env::args().skip(1).collect()) else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    match args.action {
        Action::Help => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Action::Validate(dir) => validate(&dir),
        Action::Remote(remote) => remote::run(remote, args.json),
    }
}

fn validate(dir: &Path) -> ExitCode {
    let checked = desk_core::validate_dir(dir).and_then(|manifest| {
        let problems = beyond_the_schema(dir, &manifest);
        if problems.is_empty() {
            Ok(manifest)
        } else {
            Err(problems)
        }
    });
    match checked {
        Ok(manifest) => {
            let kind = match manifest.kind {
                PluginKind::Ui => "ui",
                PluginKind::Logic => "logic",
                PluginKind::Tool => "tool",
                PluginKind::Policy => "policy",
                PluginKind::Library => "library",
                PluginKind::Connector => "connector",
                PluginKind::View => "view",
            };
            println!("ok {} {} ({kind} plugin)", manifest.id, manifest.version);
            ExitCode::SUCCESS
        }
        Err(problems) => {
            eprintln!("{}: {} problem(s)", dir.display(), problems.len());
            for problem in problems {
                eprintln!("  - {problem}");
            }
            ExitCode::from(1)
        }
    }
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
