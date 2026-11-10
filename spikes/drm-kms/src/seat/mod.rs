//! The seat: who may open the KMS card and the input devices, and when. A display server on a bare
//! VT does not open `/dev/dri/card*` or `/dev/input/event*` itself: the session manager (logind,
//! or seatd through libseat) hands out the file descriptors, makes the card's fd DRM master while
//! the session is in the foreground, and revokes the evdev fds and drops master when the person
//! switches to another VT. The compositor stops drawing on `Pause` and modesets again on `Resume`.

mod logind;
#[cfg(feature = "libseat")]
mod seatd;

use crate::options::SeatKind;
use std::io;
use std::os::fd::{AsFd, OwnedFd};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeatEvent {
    /// The session leaves the foreground: stop presenting, then call [`Seat::paused`].
    Pause,
    /// Back in the foreground: the card is master again, modeset before the next flip.
    Resume,
}

pub trait Seat {
    fn name(&self) -> String;
    /// Open a device node of the seat (the KMS card or an evdev node).
    fn open(&mut self, path: &Path) -> io::Result<OwnedFd>;
    fn close(&mut self, fd: OwnedFd);
    /// Ctrl+Alt+F<n>: switch the seat's VT. Our session pauses if `vt` is another session's.
    fn switch_vt(&mut self, vt: u32);
    /// What happened to the session since the last call (non-blocking).
    fn events(&mut self) -> Vec<SeatEvent>;
    /// The compositor stopped using the devices after a `Pause`.
    fn paused(&mut self);
}

pub fn open(kind: SeatKind) -> Result<Box<dyn Seat>, String> {
    match kind {
        SeatKind::Logind => Ok(Box::new(logind::Logind::open()?)),
        #[cfg(feature = "libseat")]
        SeatKind::Libseat => Ok(Box::new(seatd::LibSeat::open()?)),
        #[cfg(not(feature = "libseat"))]
        SeatKind::Libseat => Err("--seat=libseat needs a build with --features libseat".into()),
        SeatKind::Direct => Ok(Box::new(Direct)),
    }
}

/// No session manager: open the nodes ourselves. Works as root (or in the video and input
/// groups) on a VT nobody else draws on; the first opener of the card is DRM master. No VT
/// switching and no pause: switching away leaves the screen to whoever takes master next.
struct Direct;

impl Seat for Direct {
    fn name(&self) -> String {
        "direct (no session manager)".into()
    }
    fn open(&mut self, path: &Path) -> io::Result<OwnedFd> {
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(
                rustix::fs::OFlags::CLOEXEC.bits() as i32
                    | rustix::fs::OFlags::NONBLOCK.bits() as i32,
            )
            .open(path)?;
        Ok(file.into())
    }
    fn close(&mut self, fd: OwnedFd) {
        drop(fd);
    }
    fn switch_vt(&mut self, vt: u32) {
        eprintln!("seat: VT {vt} asked, but --seat=direct cannot switch VTs");
    }
    fn events(&mut self) -> Vec<SeatEvent> {
        vec![]
    }
    fn paused(&mut self) {}
}

/// The device number of a node, as logind's TakeDevice wants it.
pub fn major_minor(path: &Path) -> io::Result<(u32, u32)> {
    let stat = rustix::fs::stat(path)?;
    Ok((
        rustix::fs::major(stat.st_rdev),
        rustix::fs::minor(stat.st_rdev),
    ))
}

/// The device number of an open fd.
pub fn fd_major_minor(fd: &impl AsFd) -> io::Result<(u32, u32)> {
    let stat = rustix::fs::fstat(fd)?;
    Ok((
        rustix::fs::major(stat.st_rdev),
        rustix::fs::minor(stat.st_rdev),
    ))
}

/// DRM's character device major (`/dev/dri/*`).
pub const DRM_MAJOR: u32 = 226;
