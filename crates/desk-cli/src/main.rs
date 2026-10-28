//! `desk`: the command line for people and AI agents. Exit codes: 0 ok, 1 check failed, 2 usage.

use std::path::Path;
use std::process::ExitCode;

use desk_bridge::PluginKind;

const USAGE: &str = "usage: desk plugin validate <dir>";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["plugin", "validate", dir] => validate(Path::new(dir)),
        ["--help" | "-h" | "help"] => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
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
