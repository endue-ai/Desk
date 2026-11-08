//! The trash that fs.trash, a move across volumes and the undo of a copy put things in: the OS trash
//! (desk-sys) unless `with_trash` gives another, so tests never touch the trash of whoever runs them.
//! Nothing here deletes for good: a trash that cannot take a path leaves it where it is.

use std::io;
use std::path::Path;

use desk_bridge::{BridgeError, ErrorCode};
use desk_sys::fs as sysfs;

use crate::handler::{Core, error, sys_error};

/// Moves one path to a trash, or says why it could not.
pub(crate) type TrashFn = Box<dyn Fn(&Path) -> io::Result<()> + Send + Sync>;

/// The OS trash: the macOS Trash, the Windows Recycle Bin, the freedesktop trash.
pub(crate) fn system_trash() -> TrashFn {
    Box::new(sysfs::trash)
}

impl Core {
    /// Move paths to `trash` instead of the OS trash. A missing path should be `NotFound`; any other
    /// failure means the path stays where it is.
    pub fn with_trash(
        mut self,
        trash: impl Fn(&Path) -> io::Result<()> + Send + Sync + 'static,
    ) -> Self {
        self.trash = Box::new(trash);
        self
    }

    /// Move `path` to the trash.
    pub(crate) fn trash_path(&self, path: &Path) -> Result<(), BridgeError> {
        (self.trash)(path).map_err(trash_error)
    }
}

/// A trash's failure on the bridge: a missing path is `not_found`, something that is no path
/// `invalid_params`; anything else means the path did not go to a trash and stays: `unsupported`.
fn trash_error(err: io::Error) -> BridgeError {
    let failure = desk_sys::Error::from(err);
    match failure.code {
        ErrorCode::NotFound | ErrorCode::InvalidParams => sys_error(failure),
        _ => error(ErrorCode::Unsupported, failure.message),
    }
}
