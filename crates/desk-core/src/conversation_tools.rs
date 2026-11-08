//! What a conversation asks of the core while it runs a turn (`Tools`): the tools it offers and
//! runs, the desk in words (ADR 0109), the context before a turn and the episode after it (ADR
//! 0096). Split from conversation.rs, which holds the turn loop.

use desk_brain::{ToolCall, ToolDefinition, TurnContext};
use desk_bridge::{BrainDesk, BrainTurnTool, MemoryStep};
use serde_json::Value;

use crate::desk_context;

/// What runs the tools the brain asks for: the core, once it routes them (CORE-14, ADR 0088), and
/// the step the desk shows for each command call of Eris's loop (ADR 0089).
pub(crate) trait Tools: Send + Sync {
    /// The step the desk shows for a call that runs a command.
    fn step(&self, _call: &ToolCall) -> Option<BrainTurnTool> {
        None
    }
    /// The tool's output, and whether it failed. `turn` is the desk's turn the call belongs to.
    fn run(&self, turn: &str, call: &ToolCall) -> (Value, bool);
    /// The desk's turn `turn` ended.
    fn ended(&self, _turn: &str) {}
    /// The tools a turn offers the brain, those of the plugins on `desk` first; `None` offers none.
    fn offer(&self, _desk: Option<&BrainDesk>) -> Option<Vec<ToolDefinition>> {
        None
    }
    /// The desk in words for the brain, each plugin with its tools (ADR 0109).
    fn describe(&self, desk: &BrainDesk) -> String {
        desk_context::render(desk, &|_| Vec::new())
    }
    /// What the brain is told before a turn on `line` (ADR 0096).
    fn context(&self, _line: &str) -> Option<TurnContext> {
        None
    }
    /// A turn ended in words: what was asked, the answer and the commands its errands ran.
    fn finished(&self, _asked: &str, _answered: &str, _steps: Vec<MemoryStep>) {}
}
