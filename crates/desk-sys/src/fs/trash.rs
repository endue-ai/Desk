//! `trash`: move a file, a folder or a link to the OS trash with the `trash` crate. Nothing here
//! deletes for good.

use std::io;
use std::path::Path;

use super::ops::refuse;
use super::with_path;

/// Move `path` to the OS trash: the macOS Trash (`-[NSFileManager trashItemAtURL:]`, so no Finder
/// permission prompt and no "Put Back"), the Windows Recycle Bin, or the freedesktop trash on Linux
/// and the BSDs. A link goes itself; its target stays. A missing path is `NotFound`, checked here
/// before the trash is called. When the trash fails or there is none, the call fails (`Other`:
/// `io_error`) and the path stays where it is: it never falls back to deleting.
///
/// The trash runs on a thread of its own, so the apartment-threaded COM it initializes on Windows
/// never meets the caller's apartment, and a panic in the crate comes back as an error.
pub fn trash(path: &Path) -> io::Result<()> {
    if path.file_name().is_none() {
        return Err(refuse(
            io::ErrorKind::InvalidInput,
            path,
            "not a file or folder path",
        ));
    }
    std::fs::symlink_metadata(path).map_err(|err| with_path(err, path))?;
    let outcome = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("desk-sys-trash".to_owned())
            .spawn_scoped(scope, || context().delete(path))
            .map(|thread| thread.join())
    })
    .map_err(|err| with_path(err, path))?;
    let why = match outcome {
        Ok(Ok(())) => return Ok(()),
        Ok(Err(err)) => err.to_string(),
        Err(_) => "the trash panicked".to_owned(),
    };
    Err(io::Error::other(format!(
        "{}: not moved to the trash: {why}",
        path.display()
    )))
}

#[cfg(target_os = "macos")]
fn context() -> ::trash::TrashContext {
    use ::trash::macos::{DeleteMethod, TrashContextExtMacos as _};
    let mut context = ::trash::TrashContext::new();
    // The default asks Finder through AppleScript: an Automation prompt and a sound.
    context.set_delete_method(DeleteMethod::NsFileManager);
    context
}

#[cfg(not(target_os = "macos"))]
fn context() -> ::trash::TrashContext {
    ::trash::TrashContext::new()
}
