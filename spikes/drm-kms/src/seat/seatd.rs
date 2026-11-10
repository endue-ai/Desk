//! The seat through libseat (`--features libseat`): one C library over seatd, logind or its
//! builtin backend (`LIBSEAT_BACKEND` picks). What Smithay, wlroots and sway use. Works from SSH
//! too when seatd runs (`seatd-launch -- desk-kms --seat=libseat`), since seatd owns the VT.

use super::{Seat, SeatEvent};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io;
use std::os::fd::{AsFd, AsRawFd, FromRawFd, IntoRawFd, OwnedFd, RawFd};
use std::path::Path;
use std::rc::Rc;

pub struct LibSeat {
    seat: libseat::Seat,
    events: Rc<RefCell<Vec<SeatEvent>>>,
    devices: HashMap<RawFd, libseat::Device>,
}

impl LibSeat {
    pub fn open() -> Result<LibSeat, String> {
        let events = Rc::new(RefCell::new(vec![]));
        let sink = events.clone();
        let mut seat = libseat::Seat::open(move |_seat, event| {
            sink.borrow_mut().push(match event {
                libseat::SeatEvent::Enable => SeatEvent::Resume,
                libseat::SeatEvent::Disable => SeatEvent::Pause,
            });
        })
        .map_err(|e| format!("libseat: no seat ({e}); is seatd or logind running?"))?;
        // The seat is ours once libseat says Enable; seatd answers on the first dispatches.
        for _ in 0..20 {
            if events.borrow().contains(&SeatEvent::Resume) {
                break;
            }
            let _ = seat.dispatch(100);
        }
        if !events
            .borrow_mut()
            .drain(..)
            .any(|e| e == SeatEvent::Resume)
        {
            return Err("libseat: the seat never became active".into());
        }
        println!("seat: libseat {}", seat.name());
        Ok(LibSeat {
            seat,
            events,
            devices: HashMap::new(),
        })
    }
}

impl Seat for LibSeat {
    fn name(&self) -> String {
        "libseat".into()
    }

    fn open(&mut self, path: &Path) -> io::Result<OwnedFd> {
        let device = self
            .seat
            .open_device(&path)
            .map_err(|e| io::Error::other(format!("libseat open {}: {e}", path.display())))?;
        let raw = device.as_fd().as_raw_fd();
        self.devices.insert(raw, device);
        // SAFETY: libseat owns this fd until close_device; `close` hands it back without closing.
        Ok(unsafe { OwnedFd::from_raw_fd(raw) })
    }

    fn close(&mut self, fd: OwnedFd) {
        let raw = fd.into_raw_fd();
        if let Some(device) = self.devices.remove(&raw) {
            let _ = self.seat.close_device(device);
        }
    }

    fn switch_vt(&mut self, vt: u32) {
        if let Err(e) = self.seat.switch_session(vt as i32) {
            eprintln!("seat: switch to VT {vt} failed: {e}");
        }
    }

    fn events(&mut self) -> Vec<SeatEvent> {
        let _ = self.seat.dispatch(0);
        self.events.borrow_mut().drain(..).collect()
    }

    fn paused(&mut self) {
        let _ = self.seat.disable();
    }
}
