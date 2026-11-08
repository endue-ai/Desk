//! What Eris says when a turn cannot go as asked (conversation.rs, core_ask.rs, brain_choice.rs).

/// What Eris says while the brain is unreachable (docs/ko/first-run-scenario.md).
pub const OFFLINE_LINE: &str =
    "I can't reach endue right now. Check your connection, and I'll pick up where we left off.";
/// What Eris says on a desk whose session another desk took over.
pub const READ_ONLY_LINE: &str =
    "This conversation is open on another desk now, so this one is read-only.";
/// What Eris says when a turn failed for any other reason.
pub const FAILED_LINE: &str = "Something went wrong on my side. Try that again in a moment.";
/// What Eris says when the brain wants an endue ID token the desk does not have (ADR 0089).
pub const SIGN_IN_LINE: &str =
    "Sign in to endue so I can think with it: your account is at the bottom left.";
/// What Eris says when the brain kept calling tools past `MAX_STEPS` in one turn.
pub const TOO_MANY_LINE: &str =
    "I went back and forth too many times on that one. Try asking another way.";
/// The most tool calls one brain.say turn runs (ADR 0089); past it the turn ends.
pub const MAX_STEPS: usize = 12;
/// What Eris says first when the local brain answers in place of the chosen one, which cannot be
/// reached (ADR 0094); once, until the chosen brain answers again.
pub const FALLBACK_LINE: &str =
    "I can't reach the brain you chose right now, so I'm answering on this computer.";
