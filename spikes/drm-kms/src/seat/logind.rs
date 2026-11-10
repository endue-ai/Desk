//! The seat through systemd-logind's D-Bus API (zbus, pure Rust, no libsystemd), as
//! <https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html> describes it:
//! `Session.TakeControl` makes this process the session's display server (logind puts the VT in
//! graphics mode with the kernel keyboard off, so Ctrl+Alt+F<n> is ours to handle);
//! `TakeDevice(major, minor)` returns an fd per node; `PauseDevice`/`ResumeDevice` signals follow
//! the VT; `Seat.SwitchTo(vt)` switches. Runs only from a session that has a seat and a VT: a
//! text-console login, not SSH.

use super::{DRM_MAJOR, Seat, SeatEvent, fd_major_minor, major_minor};
use std::collections::HashMap;
use std::io;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};
use std::path::Path;
use std::sync::mpsc;
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::{OwnedFd as BusFd, OwnedObjectPath};

const LOGIND: &str = "org.freedesktop.login1";

enum Signal {
    Pause {
        major: u32,
        minor: u32,
        kind: String,
    },
    Resume {
        major: u32,
        minor: u32,
    },
}

pub struct Logind {
    session: Proxy<'static>,
    seat: Proxy<'static>,
    session_path: String,
    signals: mpsc::Receiver<Signal>,
    taken: HashMap<RawFd, (u32, u32)>,
    /// The card's pause waiting for `PauseDeviceComplete`.
    pending: Option<(u32, u32)>,
}

fn bus(e: zbus::Error) -> String {
    format!("logind: {e}")
}

impl Logind {
    pub fn open() -> Result<Logind, String> {
        let conn = Connection::system().map_err(bus)?;
        let manager = Proxy::new(
            &conn,
            LOGIND,
            "/org/freedesktop/login1",
            "org.freedesktop.login1.Manager",
        )
        .map_err(bus)?;
        let path: OwnedObjectPath = match std::env::var("XDG_SESSION_ID") {
            Ok(id) => manager.call("GetSession", &(id,)),
            Err(_) => manager.call("GetSessionByPID", &(std::process::id(),)),
        }
        .map_err(|e| {
            format!("logind: no session for this process ({e}); log in on a text console")
        })?;
        let session_path = path.as_str().to_owned();
        let session = Proxy::new(
            &conn,
            LOGIND,
            session_path.clone(),
            "org.freedesktop.login1.Session",
        )
        .map_err(bus)?;
        let seat_name: String = std::env::var("XDG_SEAT").unwrap_or_else(|_| "seat0".into());
        let seat_path: OwnedObjectPath = manager
            .call("GetSeat", &(seat_name.as_str(),))
            .map_err(bus)?;
        let seat = Proxy::new(
            &conn,
            LOGIND,
            seat_path.as_str().to_owned(),
            "org.freedesktop.login1.Seat",
        )
        .map_err(bus)?;
        let vt: u32 = session.get_property("VTNr").unwrap_or(0);
        let active: bool = session.get_property("Active").unwrap_or(false);
        println!("seat: logind session {session_path} on {seat_name}, VT {vt}, active {active}");
        if vt == 0 {
            return Err("logind: this session has no VT (SSH?); log in on a text console or use --seat=libseat".into());
        }
        session
            .call::<_, _, ()>("TakeControl", &(false,))
            .map_err(|e| {
                format!(
                    "logind: TakeControl refused ({e}); is another display server on this session?"
                )
            })?;
        let (tx, rx) = mpsc::channel();
        let all = session.receive_all_signals().map_err(bus)?;
        std::thread::spawn(move || {
            for message in all {
                let header = message.header();
                let Some(member) = header.member().map(|m| m.as_str().to_owned()) else {
                    continue;
                };
                let body = message.body();
                let signal = match member.as_str() {
                    "PauseDevice" => body
                        .deserialize::<(u32, u32, String)>()
                        .ok()
                        .map(|(major, minor, kind)| Signal::Pause { major, minor, kind }),
                    // The fd of a resumed evdev node is new; the card keeps its fd. We reopen
                    // evdev through libinput's resume, so the fd here is dropped either way.
                    "ResumeDevice" => body
                        .deserialize::<(u32, u32, BusFd)>()
                        .ok()
                        .map(|(major, minor, _fd)| Signal::Resume { major, minor }),
                    _ => None,
                };
                if let Some(signal) = signal
                    && tx.send(signal).is_err()
                {
                    break;
                }
            }
        });
        Ok(Logind {
            session,
            seat,
            session_path,
            signals: rx,
            taken: HashMap::new(),
            pending: None,
        })
    }
}

impl Seat for Logind {
    fn name(&self) -> String {
        format!("logind {}", self.session_path)
    }

    fn open(&mut self, path: &Path) -> io::Result<OwnedFd> {
        let (major, minor) = major_minor(path)?;
        let (fd, inactive): (BusFd, bool) = self
            .session
            .call("TakeDevice", &(major, minor))
            .map_err(|e| io::Error::other(format!("TakeDevice {}: {e}", path.display())))?;
        if inactive {
            eprintln!(
                "seat: {} taken while the session is in the background",
                path.display()
            );
        }
        let fd: OwnedFd = fd.into();
        self.taken.insert(fd.as_raw_fd(), (major, minor));
        Ok(fd)
    }

    fn close(&mut self, fd: OwnedFd) {
        let numbers = self
            .taken
            .remove(&fd.as_raw_fd())
            .or_else(|| fd_major_minor(&fd).ok());
        drop(fd);
        if let Some((major, minor)) = numbers {
            let _ = self
                .session
                .call::<_, _, ()>("ReleaseDevice", &(major, minor));
        }
    }

    fn switch_vt(&mut self, vt: u32) {
        if let Err(e) = self.seat.call::<_, _, ()>("SwitchTo", &(vt,)) {
            eprintln!("seat: SwitchTo({vt}) failed: {e}");
        }
    }

    fn events(&mut self) -> Vec<SeatEvent> {
        let mut out = vec![];
        while let Ok(signal) = self.signals.try_recv() {
            match signal {
                // The session follows the card: evdev nodes are revoked at the same time.
                Signal::Pause { major, minor, kind } if major == DRM_MAJOR => {
                    println!("seat: card {major}:{minor} paused ({kind})");
                    // "pause" waits for our PauseDeviceComplete; "force" and "gone" do not.
                    self.pending = (kind == "pause").then_some((major, minor));
                    out.push(SeatEvent::Pause);
                }
                Signal::Resume { major, minor } if major == DRM_MAJOR => {
                    println!("seat: card {major}:{minor} resumed");
                    out.push(SeatEvent::Resume);
                }
                _ => {}
            }
        }
        out
    }

    fn paused(&mut self) {
        if let Some((major, minor)) = self.pending.take() {
            let _ = self
                .session
                .call::<_, _, ()>("PauseDeviceComplete", &(major, minor));
        }
    }
}

impl Drop for Logind {
    fn drop(&mut self) {
        // logind also releases everything when our bus connection closes.
        let _ = self.session.call::<_, _, ()>("ReleaseControl", &());
    }
}
