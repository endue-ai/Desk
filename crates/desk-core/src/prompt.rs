//! Asking the person: what a permission prompt shows, and the trait the shell implements to show it.

use desk_bridge::Permission;

/// The caller id of the web runtime itself. Plugins call under their own ids.
pub const RUNTIME_CALLER: &str = "desk";

/// The longest reason a prompt shows; longer reasons are cut with an ellipsis.
const REASON_CHARS: usize = 300;

/// One question for the person: who asks, for what, and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Prompt {
    /// The caller id: a plugin id, or [`RUNTIME_CALLER`].
    pub caller: String,
    /// The caller's display name from its manifest, or the id.
    pub name: String,
    pub permission: Permission,
    /// What granting allows, in words, from the core (never from the caller).
    pub summary: String,
    /// Why the caller says it needs it: caller text, cleaned of control characters and shortened.
    pub reason: String,
}

impl Prompt {
    pub(crate) fn new(caller: &str, name: &str, permission: Permission, reason: &str) -> Self {
        Self {
            caller: caller.to_owned(),
            name: clean(name, 80),
            summary: describe(&permission),
            permission,
            reason: clean(reason, REASON_CHARS),
        }
    }
}

/// Shows prompts. Desk's native dialog implements it; `ask` blocks until the person answers, so the
/// core never calls it while holding a lock other calls need.
pub trait Prompter: Send + Sync {
    fn ask(&self, prompt: &Prompt) -> bool;
}

/// The prompter of a core without a prompt UI (tests, the CLI): it refuses everything.
#[derive(Debug, Default)]
pub struct RefuseAll;

impl Prompter for RefuseAll {
    fn ask(&self, _prompt: &Prompt) -> bool {
        false
    }
}

/// What a permission allows, as the end of "<plugin> wants to ...".
pub fn describe(permission: &Permission) -> String {
    let list = |items: &[String]| items.join(", ");
    match permission {
        Permission::FsRead(p) => format!("read files in {}", list(&p.paths)),
        Permission::FsWrite(p) => format!("create, change and delete files in {}", list(&p.paths)),
        Permission::ProcSpawn(p) => {
            let terminal = if p.pty == Some(true) {
                " in a terminal"
            } else {
                ""
            };
            format!("run {}{terminal}", list(&p.commands))
        }
        Permission::NetFetch(p) => format!("connect to {}", list(&p.hosts)),
        Permission::AudioCapture(p) => {
            if p.wake_word == Some(true) {
                "use the microphone and listen for the wake word".to_owned()
            } else {
                "use the microphone".to_owned()
            }
        }
        Permission::UiSurface(_) => "open its surfaces on the desk".to_owned(),
        Permission::UiNotify(_) => "show notifications".to_owned(),
        Permission::PluginManage(_) => "list plugins and turn them on and off".to_owned(),
        Permission::BrainConverse(_) => "talk to the brain in your session".to_owned(),
    }
}

/// Caller text made safe to show: control characters become spaces, runs of spaces collapse, and the
/// text is cut at `max` characters.
fn clean(text: &str, max: usize) -> String {
    let joined = text
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if joined.chars().count() <= max {
        return joined;
    }
    let cut: String = joined.chars().take(max - 1).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_text_loses_control_characters_and_length() {
        assert_eq!(
            clean("two\nlines\u{7}\tand  tabs", 80),
            "two lines and tabs"
        );
        let long = "a".repeat(400);
        let cut = clean(&long, REASON_CHARS);
        assert_eq!(cut.chars().count(), REASON_CHARS);
        assert!(cut.ends_with('…'));
    }
}
