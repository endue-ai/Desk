//! What crosses the desk window's edge to and from OS apps (#309, ADR 0243): a desk drag of files
//! that leaves the window becomes an OS drag (`hand_off`), and text and links an OS app drags over
//! the window reach the compositor as desk data (`listen`). The compositor decides both
//! (`desk_compositor::input::dnd::os`); this only talks to the OS.
//!
//! macOS does both (`os_dnd/macos.rs`). Windows and Linux answer a hand-off as not started, so the
//! desk drag ends with `none` and a line in the log says why, and take only files from the OS, as
//! before; OLE drag and drop for Windows is a follow-up.

use std::path::{Path, PathBuf};

use desk_compositor::input::Input;
use desk_surface::generated::{SurfaceDropAnswer, SurfaceDropEffect};
use winit::window::Window;

use crate::pump::Pump;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(test)]
mod tests;

/// NSDragOperation's bits, as AppKit numbers them.
pub const OP_COPY: usize = 1;
pub const OP_LINK: usize = 2;
pub const OP_MOVE: usize = 16;

/// The OS operations a drag offers for the desk effects its source allowed.
pub fn operation_mask(allowed: &[SurfaceDropEffect]) -> usize {
    allowed.iter().fold(0, |mask, effect| {
        mask | match effect {
            SurfaceDropEffect::Copy => OP_COPY,
            SurfaceDropEffect::Link => OP_LINK,
            SurfaceDropEffect::Move => OP_MOVE,
        }
    })
}

/// The desk effect an OS drag ended with: what its target performed, `none` for nothing.
pub fn effect_of(operation: usize) -> SurfaceDropAnswer {
    if operation & OP_MOVE != 0 {
        SurfaceDropAnswer::Move
    } else if operation & OP_COPY != 0 {
        SurfaceDropAnswer::Copy
    } else if operation & OP_LINK != 0 {
        SurfaceDropAnswer::Link
    } else {
        SurfaceDropAnswer::None
    }
}

/// A bridge path as the OS names it: `~` is the home folder.
pub fn local_path(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with('/') => home.join(rest.trim_start_matches('/')),
        _ => PathBuf::from(path),
    }
}

/// What an OS pasteboard offers as desk data: its plain text, and a URL (`public.url`) or text
/// that is one link and nothing else.
pub fn pasteboard_data(text: Option<String>, url: Option<String>) -> (Option<String>, Vec<String>) {
    let text = text.filter(|t| !t.is_empty());
    let lone = |t: &String| {
        let t = t.trim();
        let scheme = t.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
        (!t.contains(char::is_whitespace)
            && matches!(
                scheme.as_deref(),
                Some("http" | "https" | "mailto" | "file")
            ))
        .then(|| t.to_owned())
    };
    let uris: Vec<String> = url
        .filter(|u| !u.is_empty())
        .or_else(|| text.as_ref().and_then(lone))
        .into_iter()
        .collect();
    (text, uris)
}

/// Start an OS drag of `paths` from `window`, offering `allowed`; `ended` hears what the OS did
/// (`None`: cancelled, or no OS drag could start). Call on the event loop's thread, while it
/// handles the pointer event that left the window.
pub fn hand_off(
    window: &Window,
    paths: &[PathBuf],
    allowed: &[SurfaceDropEffect],
    ended: impl FnOnce(Option<SurfaceDropAnswer>) + 'static,
) {
    #[cfg(target_os = "macos")]
    if let Err(ended) = macos::hand_off(window, paths, operation_mask(allowed), Box::new(ended)) {
        eprintln!(
            "endue: the OS drag of {} file(s) did not start",
            paths.len()
        );
        ended(None);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, allowed);
        eprintln!(
            "endue: dragging {} file(s) out of the desk is not supported on this OS yet",
            paths.len()
        );
        ended(None);
    }
}

/// Hear text and links OS apps drag over `window`, as compositor input through `pump`. Files keep
/// arriving as winit's own events. Call once, on the event loop's thread.
pub fn listen(window: &Window, pump: &Pump) {
    #[cfg(target_os = "macos")]
    macos::listen(window, pump.clone(), deliver);
    #[cfg(not(target_os = "macos"))]
    let _ = (window, pump);
}

/// Hand `input` to the compositor window, on the loop.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn deliver(pump: &Pump, input: Input) {
    pump.run(move |shell, event_loop| {
        if let Some(compositor) = shell.compositor.as_mut() {
            compositor.input(event_loop, input);
        }
    });
}
