//! `desk`: the command line for people and AI agents. Exit codes: 0 ok, 1 check or call failed, 2
//! usage. `plugin validate` works offline; the other subcommands reach a running desk over its socket.

mod args;
mod remote;

use std::path::Path;
use std::process::ExitCode;

use desk_bridge::PluginKind;

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
    match desk_core::validate_dir(dir) {
        Ok(manifest) => {
            let kind = match manifest.kind {
                PluginKind::Ui => "ui",
                PluginKind::Logic => "logic",
                PluginKind::Tool => "tool",
                PluginKind::Policy => "policy",
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
