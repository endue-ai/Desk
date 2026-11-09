//! The brains the desk chooses from for Eris (ADR 0094): endue AI with the person's endue ID,
//! the local brain on Ollama, examples/brain-echo and the person's own Claude Code (ADR 0109). The
//! runtime's setting `brain.use` picks one per turn (desk-core's brain_choice.rs); each address can
//! be moved with an environment variable.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use desk_brain::Brain;
use desk_brain_endue::HttpBrain;
use desk_brain_local::{
    ClaudeCodeOptions, DEFAULT_BASE_URL, LocalBrain, LocalBrainOptions, find_claude,
};
use desk_core::Brains;
use desk_core::account::Account;

/// endue AI's brain unless `DESK_BRAIN_URL` says otherwise.
pub const DEFAULT_BRAIN_URL: &str = "https://brain.endue.ai/v0";
/// examples/brain-echo (`just brain-echo`) unless `DESK_ECHO_URL` says otherwise.
pub const DEFAULT_ECHO_URL: &str = "http://127.0.0.1:8787/v0";

/// Every brain this desk can reach, keeping their sessions in `data`. endue AI asks `account` for
/// its token on every request; Ollama is at `DESK_OLLAMA_URL` (its own default otherwise); Claude
/// Code is `DESK_CLAUDE_PATH`, else the `claude` found on PATH or where its installers put it, with
/// `DESK_CLAUDE_MODEL` as its model (Claude Code's own otherwise).
pub fn brains(data: &Path, home: &Path, account: Arc<Account>) -> Brains {
    let mut brains = Brains::default().with_folder(data);
    let endue = url("DESK_BRAIN_URL", DEFAULT_BRAIN_URL);
    match HttpBrain::new(&endue) {
        // The person's endue ID (ADR 0089): signing in hands the brain its bearer token.
        Ok(brain) => {
            let brain = brain.with_token_source(Arc::new(move || account.token()));
            brains = brains.with_endue(Arc::new(brain));
        }
        Err(why) => eprintln!("endue Desk: no endue AI brain ({why})"),
    }
    match HttpBrain::new(&url("DESK_ECHO_URL", DEFAULT_ECHO_URL)) {
        Ok(brain) => brains = brains.with_echo(Arc::new(brain)),
        Err(why) => eprintln!("endue Desk: no echo brain ({why})"),
    }
    // A Claude Code not found now still answers as `claude` on PATH, or is unreachable, so the
    // choice exists and the local brain stands in (ADR 0094).
    let program = std::env::var_os("DESK_CLAUDE_PATH")
        .map(PathBuf::from)
        .or_else(|| find_claude(std::env::var_os("PATH"), Some(home.to_path_buf())))
        .unwrap_or_else(|| PathBuf::from("claude"));
    let mut claude = ClaudeCodeOptions::new(program);
    if let Ok(model) = std::env::var("DESK_CLAUDE_MODEL") {
        claude = claude.with_model(model);
    }
    match LocalBrain::claude_code(data.join("claude-brain"), claude) {
        Ok(brain) => brains = brains.with_claude(Arc::new(brain)),
        Err(why) => eprintln!("endue Desk: no Claude Code brain ({why})"),
    }
    let ollama = url("DESK_OLLAMA_URL", DEFAULT_BASE_URL);
    let folder = data.join("local-brain");
    brains.with_local(move |model: &str| {
        let options = LocalBrainOptions::new(model).with_base_url(ollama.clone());
        let brain = LocalBrain::open(folder.join(file_safe(model)), options)?;
        Ok(Arc::new(brain) as Arc<dyn Brain>)
    })
}

fn url(variable: &str, default: &str) -> String {
    std::env::var(variable).unwrap_or_else(|_| default.to_owned())
}

/// A model name as a folder name: letters, digits, `.`, `-` and `_`; anything else is `_`.
fn file_safe(model: &str) -> String {
    model
        .chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => c,
            _ => '_',
        })
        .collect()
}
