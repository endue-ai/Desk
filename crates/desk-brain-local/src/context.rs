//! The desk's context for a turn (`TurnContext`, Desk ADR 0096) as one system message for the model:
//! the facts the desk keeps about the person, earlier turns, and what is open on the desk. It goes
//! with its turn only and never joins the stored conversation.

use desk_brain::TurnContext;
use serde_json::{Value, json};

/// The system message for `context`, or none when it says nothing.
pub fn message(context: Option<&TurnContext>) -> Option<Value> {
    let context = context?;
    let mut lines = vec!["Background from the desk, not the person's words:".to_owned()];
    if let Some(facts) = context.facts.as_ref().filter(|f| !f.is_empty()) {
        lines.push("What you know about the person:".to_owned());
        lines.extend(facts.iter().map(|fact| format!("- {}", fact.text)));
    }
    if let Some(episodes) = context.episodes.as_ref().filter(|e| !e.is_empty()) {
        lines.push("Earlier turns, newest first:".to_owned());
        lines.extend(episodes.iter().map(|episode| {
            format!(
                "- {} asked \"{}\"; you answered \"{}\"",
                episode.at, episode.asked, episode.answered
            )
        }));
    }
    if let Some(working) = &context.working {
        lines.push(format!("It is {} now.", working.now));
        if let Some(surfaces) = working.surfaces.as_ref().filter(|s| !s.is_empty()) {
            lines.push(format!("Open on the desk: {}.", surfaces.join(", ")));
        }
        if let Some(commands) = working.commands.as_ref().filter(|c| !c.is_empty()) {
            lines.push(format!("Commands run last: {}.", commands.join(", ")));
        }
    }
    (lines.len() > 1).then(|| json!({ "role": "system", "content": lines.join("\n") }))
}
