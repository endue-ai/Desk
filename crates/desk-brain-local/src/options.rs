//! What a `LocalBrain` talks to and asks for: Ollama's address, the model, the tools it offers of
//! its own, and the agent the model speaks for.

use serde_json::Value;

/// Where Ollama listens unless told otherwise.
pub const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";

/// Which Ollama to talk to and what to ask it for.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalBrainOptions {
    /// Ollama's base URL, `http://127.0.0.1:11434` by default.
    pub base_url: String,
    /// The model every turn uses, for example `llama3.2`. It must already be pulled.
    pub model: String,
    /// Tool definitions offered to the model, in Ollama's format. Without any, it calls no tools.
    pub tools: Vec<Value>,
    /// The agent the model's tool calls speak for (`ToolCall.agentId`): Desk runs them as
    /// `agent:<id>`, capped by `agents.<id>.allow` in init.yaml (ADR 0072, 0084). Without one,
    /// Desk runs only echo for it.
    pub agent: Option<String>,
}

impl LocalBrainOptions {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.to_owned(),
            model: model.into(),
            tools: Vec::new(),
            agent: None,
        }
    }

    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    pub fn with_tools(mut self, tools: Vec<Value>) -> Self {
        self.tools = tools;
        self
    }

    /// Speak for the agent `id` (`local`, say), so the desk runs the model's tool calls as it.
    pub fn with_agent(mut self, id: impl Into<String>) -> Self {
        self.agent = Some(id.into());
        self
    }

    /// An agent id is what `ToolCall.agentId` takes: a letter or digit, then up to 121 letters,
    /// digits, `_`, `.` or `-`.
    pub(crate) fn check_agent(&self) -> Result<(), String> {
        let Some(id) = &self.agent else {
            return Ok(());
        };
        let mut chars = id.chars();
        let first = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
        let rest = chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
        if first && rest && id.len() <= 122 {
            Ok(())
        } else {
            Err(format!("{id} is not an agent id"))
        }
    }
}
