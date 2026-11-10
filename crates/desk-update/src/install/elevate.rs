//! Asking the OS, once, to run one step of an update as an administrator (#99, ADR 0163). The step
//! is a program and its arguments, never a line a shell parses from text the desk put together. On
//! macOS `osascript` asks through Authorization Services (`do shell script … with administrator
//! privileges`), each argument quoted by AppleScript's `quoted form of`; on Linux `pkexec` asks
//! through polkit. Windows asks through UAC in the installer's own script, once the desk has quit
//! (`windows.rs`), so nothing here runs there.
//!
//! The app hands the installer a `SystemPrompt`; tests hand it one that never asks anyone.

use std::process::{Command, Output, Stdio};

/// One step to run as an administrator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    /// What the OS's prompt says the step is for, when the OS shows text of ours.
    pub why: String,
    pub program: String,
    pub args: Vec<String>,
}

/// Why a step did not run, or did not succeed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refusal {
    /// The person cancelled the OS's prompt: nothing ran.
    Declined,
    /// The prompt could not be shown, or the step failed: what was said.
    Failed(String),
}

/// What runs a step as an administrator after asking the person once.
pub trait Elevate: Send + Sync {
    fn run(&self, step: &Step) -> Result<(), Refusal>;
}

/// The OS's own prompt.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemPrompt;

impl Elevate for SystemPrompt {
    fn run(&self, step: &Step) -> Result<(), Refusal> {
        let (program, args) = system_command(step)?;
        run(&program, &args)
    }
}

/// Run `program` with `args`, its input closed, and read how it ended.
pub fn run(program: &str, args: &[String]) -> Result<(), Refusal> {
    let output = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| Refusal::Failed(format!("Desk could not run {program}: {e}")))?;
    judge(&output)
}

/// The AppleScript that runs its arguments after the first as one command, as an administrator when
/// `admin`; the first argument is the prompt's text.
pub fn ask_script(admin: bool) -> String {
    let privileges = if admin {
        " with administrator privileges"
    } else {
        ""
    };
    format!(
        "on run argv\n\
         set command to \"\"\n\
         repeat with i from 2 to count of argv\n\
         set command to command & quoted form of (item i of argv) & \" \"\n\
         end repeat\n\
         do shell script command with prompt (item 1 of argv){privileges}\n\
         end run"
    )
}

/// What runs `step` behind the OS's prompt on this OS.
fn system_command(step: &Step) -> Result<(String, Vec<String>), Refusal> {
    if cfg!(target_os = "macos") {
        Ok(osascript_command(step, true))
    } else if cfg!(target_os = "linux") {
        Ok(pkexec_command(step))
    } else {
        Err(Refusal::Failed(
            "this OS asks for an administrator in its installer".to_owned(),
        ))
    }
}

/// `osascript -e <ask_script> <why> <program> <args…>`, as an administrator when `admin`: the
/// step's words reach the script as arguments, so no part of them is ever read as AppleScript.
pub fn osascript_command(step: &Step, admin: bool) -> (String, Vec<String>) {
    let mut args = vec!["-e".to_owned(), ask_script(admin), step.why.clone()];
    args.push(step.program.clone());
    args.extend(step.args.iter().cloned());
    ("/usr/bin/osascript".to_owned(), args)
}

/// `pkexec <program> <args…>`, which asks through the desktop's polkit agent.
pub fn pkexec_command(step: &Step) -> (String, Vec<String>) {
    let mut args = vec![step.program.clone()];
    args.extend(step.args.iter().cloned());
    ("pkexec".to_owned(), args)
}

/// Read how the prompt and the step ended. `osascript` says `User canceled. (-128)` for a cancelled
/// prompt and `… (<status>)` after a step's own words; `pkexec` exits 126 for a dismissed prompt.
fn judge(output: &Output) -> Result<(), Refusal> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let code = output.status.code();
    if stderr.contains("(-128)") || (cfg!(target_os = "linux") && code == Some(126)) {
        return Err(Refusal::Declined);
    }
    let said = said(&stderr);
    Err(Refusal::Failed(if said.is_empty() {
        let code = code.map_or("on a signal".to_owned(), |c| format!("with {c}"));
        format!("the administrator's step ended {code}")
    } else {
        said
    }))
}

/// The words of an `osascript` error without its position and number: `0:42: execution error: the
/// update changed (65)` says `the update changed`. Other text is kept as it is, trimmed.
pub fn said(stderr: &str) -> String {
    let text = stderr.trim();
    let text = text
        .split_once("execution error: ")
        .map_or(text, |(_, rest)| rest);
    let text = match text.rfind(" (") {
        Some(at) if text.ends_with(')') && text[at + 2..text.len() - 1].parse::<i64>().is_ok() => {
            &text[..at]
        }
        _ => text,
    };
    text.trim().to_owned()
}

/// The reason an update gives when the person cancelled the prompt to `what`.
pub fn declined(what: &str) -> String {
    format!(
        "the administrator prompt to {what} was cancelled. Nothing changed; the update stays ready"
    )
}

#[cfg(test)]
mod tests {
    use super::{Refusal, Step, osascript_command, pkexec_command, run, said};

    fn step() -> Step {
        Step {
            why: "endue Desk wants to install 0.6.0.".to_owned(),
            program: "dpkg".to_owned(),
            args: vec!["-i".to_owned(), "/u/0.6.0/install.deb".to_owned()],
        }
    }

    #[test]
    fn the_step_reaches_the_prompt_as_arguments() {
        let (program, args) = osascript_command(&step(), true);
        assert_eq!(program, "/usr/bin/osascript");
        assert_eq!(args[0], "-e");
        let asks = |script: &str| script.contains("with administrator privileges");
        assert!(asks(&args[1]), "{}", args[1]);
        let rest = [
            "endue Desk wants to install 0.6.0.",
            "dpkg",
            "-i",
            "/u/0.6.0/install.deb",
        ];
        assert_eq!(args[2..], rest);
        assert!(!asks(&osascript_command(&step(), false).1[1]));
        let (program, args) = pkexec_command(&step());
        assert_eq!(program, "pkexec");
        assert_eq!(args, ["dpkg", "-i", "/u/0.6.0/install.deb"]);
    }

    #[test]
    fn an_osascript_error_says_only_its_words() {
        let error = "0:263: execution error: the update changed after Desk checked it (65)\n";
        assert_eq!(said(error), "the update changed after Desk checked it");
        let pkexec = "Error executing command as another user";
        assert_eq!(said(pkexec), pkexec);
        assert_eq!(said("  it ended (badly)  "), "it ended (badly)");
    }

    /// The prompt's script, run without administrator privileges (so no prompt shows): every
    /// argument reaches the command whole, whatever quotes, spaces or `$` it holds, and a step's
    /// failure comes back in its own words.
    #[cfg(target_os = "macos")]
    #[test]
    fn every_argument_reaches_the_command_whole() {
        let dir = std::env::temp_dir().join(format!("desk-elevate-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("args");
        let tricky = r#"/Applications/it's "endue" Desk $HOME `x` \.app"#;
        let printf = "printf '%s\\n' \"$@\" > \"$0\"; [ \"$2\" = ok ] || { echo \"it said $2\" >&2; exit 3; }";
        let step = |second: &str| Step {
            why: "why".to_owned(),
            program: "/bin/sh".to_owned(),
            args: ["-c", printf, out.to_str().unwrap(), tricky, second]
                .map(str::to_owned)
                .to_vec(),
        };
        let (program, args) = osascript_command(&step("ok"), false);
        assert_eq!(run(&program, &args), Ok(()));
        let written = std::fs::read_to_string(&out).unwrap();
        assert_eq!(written, format!("{tricky}\nok\n"));
        let (program, args) = osascript_command(&step("two words"), false);
        let failed = Refusal::Failed("it said two words".to_owned());
        assert_eq!(run(&program, &args), Err(failed));
        let _ = std::fs::remove_dir_all(dir);
    }
}
