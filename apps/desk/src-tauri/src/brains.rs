//! The brains the desk chooses from for Eris (ADR 0094): endue AI with the person's endue ID,
//! the local brain on Ollama, and examples/brain-echo. The runtime's setting `brain.use` picks one
//! per turn (desk-core's brain_choice.rs); each address can be moved with an environment variable.

use std::path::Path;
use std::sync::Arc;

use desk_brain::Brain;
use desk_brain_endue::HttpBrain;
use desk_brain_local::{DEFAULT_BASE_URL, LocalBrain, LocalBrainOptions};
use desk_core::Brains;
use desk_core::account::Account;

/// endue AI's brain unless `DESK_BRAIN_URL` says otherwise.
pub const DEFAULT_BRAIN_URL: &str = "https://brain.endue.ai/v0";
/// examples/brain-echo (`just brain-echo`) unless `DESK_ECHO_URL` says otherwise.
pub const DEFAULT_ECHO_URL: &str = "http://127.0.0.1:8787/v0";

/// Every brain this desk can reach, keeping their sessions in `data`. endue AI asks `account` for
/// its token on every request; Ollama is at `DESK_OLLAMA_URL` (its own default otherwise).
pub fn brains(data: &Path, account: Arc<Account>) -> Brains {
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
