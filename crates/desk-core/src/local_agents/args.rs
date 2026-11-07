//! The arguments of a run, as plugins/local-agents/ui/catalog.js builds them: Claude Code in print
//! mode with stream-json, Codex's `exec --json`. Read-only access is Claude Code's plan mode and
//! Codex's read-only sandbox; no flag that widens a program's permissions is ever passed, and
//! nothing the caller gives can become an option.

use desk_bridge::LocalAgentId;

/// The arguments of one ask: `prompt` as one argument, `session` resumed, `model` as --model.
pub(crate) fn args(
    agent: LocalAgentId,
    prompt: &str,
    session: Option<&str>,
    model: Option<&str>,
    read_only: bool,
) -> Vec<String> {
    let owned = |words: &[&str]| words.iter().map(|w| (*w).to_owned()).collect::<Vec<_>>();
    let mut args = match agent {
        LocalAgentId::Claude => owned(&["-p", "--output-format", "stream-json", "--verbose"]),
        LocalAgentId::Codex => owned(&["exec", "--json", "--skip-git-repo-check"]),
    };
    if read_only {
        args.extend(match agent {
            LocalAgentId::Claude => owned(&["--permission-mode", "plan"]),
            LocalAgentId::Codex => owned(&["--sandbox", "read-only"]),
        });
    }
    if let Some(model) = model.filter(|m| is_value(m)) {
        args.extend(owned(&["--model", model]));
    }
    if let Some(id) = session.filter(|s| super::is_session_id(s)) {
        args.push(
            if agent == LocalAgentId::Claude {
                "--resume"
            } else {
                "resume"
            }
            .to_owned(),
        );
        args.push(id.to_owned());
    }
    args.push(prompt_arg(prompt));
    args
}

/// A prompt as one argument: no NUL, never read as an option (a leading dash gets a space first).
pub(crate) fn prompt_arg(text: &str) -> String {
    let clean = text.replace('\0', "");
    if clean.starts_with('-') {
        format!(" {clean}")
    } else {
        clean
    }
}

/// A model name a program may see: no spaces, never an option.
pub(crate) fn is_value(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && text.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || "._:/@+-".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_runs_read_only_in_plan_mode_and_resumes_its_session() {
        let args = args(
            LocalAgentId::Claude,
            "-rm everything",
            Some("s-1"),
            Some("opus"),
            true,
        );
        assert_eq!(
            args,
            [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--permission-mode",
                "plan",
                "--model",
                "opus",
                "--resume",
                "s-1",
                " -rm everything"
            ]
        );
    }

    #[test]
    fn codex_runs_read_only_in_its_sandbox_and_never_takes_an_option_as_a_value() {
        let args = args(
            LocalAgentId::Codex,
            "hi\0",
            Some("-x"),
            Some("--yolo"),
            false,
        );
        assert_eq!(args, ["exec", "--json", "--skip-git-repo-check", "hi"]);
        let read_only = super::args(LocalAgentId::Codex, "hi", Some("t-1"), None, true);
        assert_eq!(
            read_only,
            [
                "exec",
                "--json",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "resume",
                "t-1",
                "hi"
            ]
        );
    }
}
