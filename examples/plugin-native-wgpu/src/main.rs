//! examples/plugin-native-wgpu: the smallest native plugin (#59, ADR 0154). The desk starts this
//! program when its window opens or wakes (`plugin.json`, kind `native`). It reads one setting of its
//! own over the bridge (`settings.get`), says hello, and draws a turning triangle with wgpu into an
//! IOSurface it attaches to its surface, at the desk's pace, while the window is shown. Before it
//! sleeps it keeps its angle with the desk, which hands it back when it wakes. It exits when the
//! desk closes its connection.

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod scene;
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod shown;

use std::io;
use std::process::ExitCode;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("plugin-native-wgpu: {why}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(target_os = "macos")]
mod mac;

#[cfg(target_os = "macos")]
fn run() -> io::Result<()> {
    mac::run()
}

/// Frames from another process reach the compositor on macOS only, until #61.
#[cfg(not(target_os = "macos"))]
fn run() -> io::Result<()> {
    Err(io::Error::other(
        "native plugins draw on macOS only until #61 imports DMA-BUFs and D3D11 handles",
    ))
}
