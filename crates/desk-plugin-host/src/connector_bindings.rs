//! Rust types and host glue generated from specs/wit/desk-connector.wit (the `connector` world).
//! The `desk:host` interfaces it imports are the `plugin` world's modules (`with`), so one `State`
//! serves both worlds.

wasmtime::component::bindgen!({
    path: "../../specs/wit",
    world: "desk:connector/connector",
    additional_derives: [PartialEq],
    with: { "desk:host": crate::bindings::desk::host },
});

// `Instance`, `ItemQuery`, `ItemPage` and `SyncResult` are the world's own `use`, at this level.
pub(crate) use desk::connector::types::{Item, ItemChange, ItemKind};

// The types interface has no functions; the generated trait still wants an impl.
impl desk::connector::types::Host for crate::state::State {}
