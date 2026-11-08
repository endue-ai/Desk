//! The person's own Claude Code as a `LocalBrain`'s model (ADR 0109). Every answer is one run of
//! `claude -p` in the brain's folder: no tools of its own (`--tools ""`), no MCP servers, hooks,
//! skills or CLAUDE.md (`--strict-mcp-config`, `--safe-mode`), no slash commands, nothing saved
//! (`--no-session-persistence`), and permissions that never prompt (`--permission-mode dontAsk`).
//! The desk's tools go in the system prompt and the answer comes back through `--json-schema`
//! (`claude_prompt.rs`); the conversation goes on stdin. It signs in with the person's own Claude
//! account, as their terminal does: Desk holds no key.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use desk_brain::{BrainError, BrainErrorCode, BrainFailure, StopReason};
use serde_json::Value;

use crate::claude_prompt;
use crate::model::{Answer, Model, Piece};

/// How long one answer may take before the run is stopped.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);
/// How long a reachability answer is kept, so brain.status does not start a program every time.
const REACH_KEPT: Duration = Duration::from_secs(30);

/// Which Claude Code to run, and with which model.
#[derive(Debug, Clone, PartialEq)]
pub struct ClaudeCodeOptions {
    /// The `claude` program (`find_claude` finds it).
    pub program: PathBuf,
    /// `--model`: an alias (`sonnet`, `haiku`) or a full name; `None` keeps Claude Code's own.
    pub model: Option<String>,
    pub timeout: Duration,
}

impl ClaudeCodeOptions {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            model: None,
            timeout: DEFAULT_TIMEOUT,
        }
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        let model = model.into();
        self.model = (!model.trim().is_empty()).then(|| model.trim().to_owned());
        self
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
}

/// The `claude` program: the first on `path`, else in the folders installers use under `home`
/// and the system's, as an app started from the Finder does not have the terminal's PATH.
pub fn find_claude(path: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["claude.exe", "claude.cmd"]
    } else {
        &["claude"]
    };
    let mut folders: Vec<PathBuf> = path.iter().flat_map(std::env::split_paths).collect();
    if let Some(home) = home {
        for under in [
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
        ] {
            folders.push(home.join(under));
        }
    }
    folders.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    folders
        .iter()
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|candidate| candidate.is_file())
}

pub(crate) struct ClaudeCode {
    options: ClaudeCodeOptions,
    folder: PathBuf,
    reached: Mutex<Option<(Instant, bool)>>,
}

impl ClaudeCode {
    pub(crate) fn new(options: ClaudeCodeOptions, folder: PathBuf) -> Self {
        Self {
            options,
            folder,
            reached: Mutex::new(None),
        }
    }
}

impl Model for ClaudeCode {
    fn chat(
        &self,
        tools: &[Value],
        messages: &[Value],
        on: &mut dyn FnMut(Piece<'_>),
    ) -> Result<Answer, BrainFailure> {
        // A system message first is the turn's toolChoice asking for a call (tools.rs).
        let required = messages.first().is_some_and(|m| m["role"] == "system");
        let args = arguments(&self.options, tools, required);
        let prompt = claude_prompt::transcript(messages);
        let output = run(&self.options, &args, &prompt, &self.folder)?;
        let answer = read(&output, tools.is_empty())?;
        on(Piece::Opened);
        if answer.calls.is_empty() && !answer.text.is_empty() {
            on(Piece::Text(&answer.text));
        }
        Ok(answer)
    }

    fn reachable(&self) -> Result<(), BrainFailure> {
        let mut reached = self.reached.lock().unwrap_or_else(|p| p.into_inner());
        let fresh = reached.filter(|(at, _)| at.elapsed() < REACH_KEPT);
        let ok = match fresh {
            Some((_, ok)) => ok,
            None => {
                let quick = ClaudeCodeOptions {
                    timeout: Duration::from_secs(15),
                    ..self.options.clone()
                };
                let ok = run(&quick, &["--version".to_owned()], "", &self.folder)
                    .is_ok_and(|output| output.success);
                *reached = Some((Instant::now(), ok));
                ok
            }
        };
        if ok {
            Ok(())
        } else {
            let program = self.options.program.display();
            Err(BrainFailure::Unreachable(format!(
                "Claude Code does not run at {program}"
            )))
        }
    }

    fn address(&self) -> String {
        self.options.program.display().to_string()
    }
}

/// The arguments of one answer. `--tools ""` is always there: Claude Code never acts on its own.
pub(crate) fn arguments(
    options: &ClaudeCodeOptions,
    tools: &[Value],
    required: bool,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "json",
        "--tools",
        "",
        "--strict-mcp-config",
        "--safe-mode",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--system-prompt",
    ]
    .map(str::to_owned)
    .into();
    args.push(claude_prompt::system(tools));
    if let Some(schema) = claude_prompt::schema(tools, required) {
        args.extend(["--json-schema".to_owned(), schema]);
    }
    if let Some(model) = &options.model {
        args.extend(["--model".to_owned(), model.clone()]);
    }
    args
}

/// What a run printed, and whether it exited well.
pub(crate) struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Run the program in `folder` with `args`, `stdin` written and closed, until it exits or the
/// options' timeout passes (then it is stopped).
fn run(
    options: &ClaudeCodeOptions,
    args: &[String],
    stdin: &str,
    folder: &Path,
) -> Result<Output, BrainFailure> {
    let program = options.program.display().to_string();
    let mut child = Command::new(&options.program)
        .args(args)
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| BrainFailure::Unreachable(format!("Claude Code at {program}: {e}")))?;
    let input = child.stdin.take().map(|mut pipe| {
        let text = stdin.to_owned();
        thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
        })
    });
    let reader = |pipe: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_string(&mut text);
            }
            text
        })
    };
    let stdout = reader(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let stderr = reader(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let deadline = Instant::now() + options.timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let late = format!("Claude Code did not answer within {:?}", options.timeout);
                return Err(BrainFailure::Unreachable(late));
            }
        }
    };
    if let Some(input) = input {
        let _ = input.join();
    }
    Ok(Output {
        success: status.success(),
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

/// A run's output as the model's answer. `plain`: the turn had no tools, so no schema was asked.
pub(crate) fn read(output: &Output, plain: bool) -> Result<Answer, BrainFailure> {
    let parsed = result_of(&output.stdout);
    let Some(result) = parsed else {
        let said = first_line(&output.stderr).unwrap_or("it printed no answer");
        if said.contains("unknown option") {
            let why =
                format!("Claude Code refused an option ({said}); update it with claude update");
            return Err(refused(400, BrainErrorCode::InvalidRequest, why));
        }
        if output.success {
            return Err(BrainFailure::Protocol(format!(
                "Claude Code's output is not JSON: {said}"
            )));
        }
        return Err(BrainFailure::Unreachable(format!(
            "Claude Code stopped: {said}"
        )));
    };
    let text = result["result"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_owned();
    if result["is_error"] == true {
        let status = result["api_error_status"]
            .as_u64()
            .and_then(|s| u16::try_from(s).ok());
        let said = if text.is_empty() {
            "it failed".to_owned()
        } else {
            text
        };
        return Err(match status {
            None => BrainFailure::Unreachable(format!("Claude Code: {said}")),
            Some(500..) => BrainFailure::Unreachable(format!("Claude Code: {said}")),
            Some(429) => refused(429, BrainErrorCode::RateLimited, said),
            Some(401 | 403) => {
                let why =
                    format!("Claude Code is not signed in; run claude in a terminal ({said})");
                refused(401, BrainErrorCode::Internal, why)
            }
            Some(status) => refused(status, BrainErrorCode::Internal, said),
        });
    }
    let (said, calls) = match result.get("structured_output") {
        Some(structured) if !plain && structured.is_object() => claude_prompt::answer(structured)?,
        _ => (text, Vec::new()),
    };
    if said.is_empty() && calls.is_empty() {
        return Err(BrainFailure::Protocol(
            "Claude Code answered nothing".to_owned(),
        ));
    }
    let stop = if !calls.is_empty() {
        StopReason::ToolCall
    } else if result["stop_reason"] == "max_tokens" {
        StopReason::MaxTokens
    } else {
        StopReason::EndTurn
    };
    Ok(Answer {
        text: said,
        calls,
        stop,
    })
}

/// The result object of `--output-format json`: the object itself, or the last `result` of a list.
fn result_of(stdout: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(stdout.trim()).ok()? {
        object @ Value::Object(_) => Some(object),
        Value::Array(items) => items
            .into_iter()
            .rev()
            .find(|item| item["type"] == "result"),
        _ => None,
    }
}

fn first_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

fn refused(status: u16, code: BrainErrorCode, message: String) -> BrainFailure {
    BrainFailure::Refused {
        status,
        error: BrainError {
            code,
            message,
            holder: None,
        },
    }
}

#[cfg(test)]
#[path = "claude_tests.rs"]
mod tests;
