//! The environment a native plugin's process starts with (`specs/surface/v0/native.md`): the desk
//! that starts it and the plugin that reads it name the same variables from here.

/// The plugin's id.
pub const PLUGIN_ID: &str = "DESK_PLUGIN_ID";

/// Unix: the file descriptor of the surface connection, a stream socket the process inherited.
pub const SURFACE_FD: &str = "DESK_SURFACE_FD";

/// Unix: the file descriptor of the bridge connection (the wire of `desk.sock`).
pub const BRIDGE_FD: &str = "DESK_BRIDGE_FD";

/// macOS: the bootstrap name of the desk's port for the process's Mach send rights.
pub const MACH_SERVICE: &str = "DESK_SURFACE_MACH_SERVICE";

/// The longest line either side writes on the surface connection, `\n` included.
pub const MOST_LINE: usize = 1 << 20;
