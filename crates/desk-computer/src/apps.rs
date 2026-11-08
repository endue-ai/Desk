//! Running applications, and what `Control` may do to them: launch by bundle id or path, activate,
//! hide, quit. Quitting asks the app politely, as the Dock's Quit does; nothing here force-quits, so
//! an app with unsaved work keeps its chance to ask the person.

use std::fmt;

use crate::{Error, invalid};

/// One running application.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct App {
    pub pid: i32,
    pub name: String,
    pub bundle_id: Option<String>,
    /// The bundle's path, when it has one.
    pub path: Option<String>,
    /// The frontmost app, which receives keyboard input.
    pub active: bool,
    pub hidden: bool,
    /// An ordinary app with a Dock icon and menu bar; agents and helpers are not.
    pub regular: bool,
}

/// Which application to launch.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Launch {
    /// A bundle identifier such as `com.apple.TextEdit`.
    BundleId(String),
    /// An absolute path to an `.app` bundle.
    Path(String),
}

impl Launch {
    /// `invalid_params` unless a bundle id is 1–255 letters, digits, `.` and `-`, or a path is
    /// absolute, names an `.app` bundle and holds no control characters.
    pub fn check(&self) -> Result<(), Error> {
        match self {
            Launch::BundleId(id) => {
                let ok = !id.is_empty()
                    && id.len() <= 255
                    && id
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
                if !ok {
                    return Err(invalid(format!("{id:?} is not a bundle identifier")));
                }
            }
            Launch::Path(path) => {
                let trimmed = path.trim_end_matches('/');
                let ok = path.starts_with('/')
                    && !path.chars().any(char::is_control)
                    && trimmed.to_ascii_lowercase().ends_with(".app");
                if !ok {
                    return Err(invalid(format!(
                        "{path:?} is not an absolute path to an .app bundle"
                    )));
                }
            }
        }
        Ok(())
    }
}

impl fmt::Display for Launch {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Launch::BundleId(id) => f.write_str(id),
            Launch::Path(path) => f.write_str(path),
        }
    }
}

/// What `Control` may do to a running app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AppOp {
    /// Unhide it and bring it to the front with its windows.
    Activate,
    Hide,
    /// Ask it to quit, as the Dock's Quit does; it may ask to save first, or refuse.
    Quit,
}

impl AppOp {
    pub fn verb(self) -> &'static str {
        match self {
            AppOp::Activate => "activate",
            AppOp::Hide => "hide",
            AppOp::Quit => "quit",
        }
    }
}
