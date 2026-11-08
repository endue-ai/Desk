//! What answers a `LocalBrain`: a model on this machine (Ollama, `ollama.rs`) or the person's own
//! Claude Code (`claude.rs`, ADR 0109). The brain keeps the sessions, leases and the conversation in
//! Ollama's message form (`ollama::user`, `assistant`, `tool`) whatever answers; a model reads that
//! conversation and the turn's tools, also in Ollama's form, and answers text or tool calls.

use desk_brain::{BrainFailure, StopReason};
use serde_json::{Map, Value};

/// One tool invocation the model asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct Call {
    pub name: String,
    pub arguments: Map<String, Value>,
}

/// What the model answered.
#[derive(Debug, Clone, PartialEq)]
pub struct Answer {
    pub text: String,
    pub calls: Vec<Call>,
    pub stop: StopReason,
}

/// What a model hands over while it answers.
pub enum Piece<'a> {
    /// The model accepted the request; the answer follows.
    Opened,
    Text(&'a str),
}

/// A model a `LocalBrain` asks.
pub trait Model: Send + Sync {
    /// Answer the conversation `messages` with the `tools` offered (both in Ollama's form). Nothing
    /// reaches `on` before the model has accepted the request, so a refusal or an unreachable model
    /// leaves no trace in the turn.
    fn chat(
        &self,
        tools: &[Value],
        messages: &[Value],
        on: &mut dyn FnMut(Piece<'_>),
    ) -> Result<Answer, BrainFailure>;

    /// Whether the model can answer now, without asking it anything: `Unreachable` when not.
    fn reachable(&self) -> Result<(), BrainFailure>;

    /// Where the model is, for people: Ollama's URL, or the Claude Code program.
    fn address(&self) -> String;
}
