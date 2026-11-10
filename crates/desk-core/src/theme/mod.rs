//! The look in force for the desk's own drawing (ADR 0146). The runtime resolves themes and design
//! systems while it still does; `theme.tokens` hands their result to the core, which keeps it as the
//! flat token table the compositor reads. Tokens flow one way: theme → table → compositor.

mod tokens;

pub(crate) use tokens::ThemeTokens;
pub use tokens::TokenTable;
