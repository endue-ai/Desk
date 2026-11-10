//! macOS: IOSurfaces between a native plugin's process and the desk, as Mach send rights
//! (`IOSurfaceCreateMachPort`, `IOSurfaceLookupFromMachPort`). An IOSurface is not global, so its id
//! means nothing in another process; its right does. The desk checks in a port of its own for each
//! process under a bootstrap name it hands the process ([`crate::env::MACH_SERVICE`]); the plugin
//! looks the name up and sends one Mach message per right, with the IOSurfaceID inline, just before
//! the line that names it. The desk takes the message when it reads that line, and keeps it only if
//! the kernel's audit token says the process it started sent it, and the right's IOSurface has the
//! id the message says.
#![allow(unsafe_code)]

use std::ffi::CString;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use mach2::bootstrap::{bootstrap_check_in, bootstrap_look_up, bootstrap_port};
use mach2::kern_return::KERN_SUCCESS;
use mach2::mach_port::{mach_port_deallocate, mach_port_mod_refs};
use mach2::message::{
    MACH_MSG_PORT_DESCRIPTOR, MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_MOVE_SEND,
    MACH_MSGH_BITS_COMPLEX, MACH_RCV_MSG, MACH_RCV_TIMED_OUT, MACH_RCV_TIMEOUT, MACH_SEND_MSG,
    MACH_SEND_TIMEOUT, audit_token_t, mach_msg, mach_msg_audit_trailer_t, mach_msg_body_t,
    mach_msg_header_t, mach_msg_port_descriptor_t,
};
use mach2::port::{MACH_PORT_NULL, MACH_PORT_RIGHT_RECEIVE, mach_port_t};
use mach2::traps::mach_task_self;
use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;

/// `MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT)`: the receive asks for the sender's audit
/// token (format 0, `MACH_RCV_TRAILER_TYPE(0)`, is 0).
const RCV_AUDIT: i32 = 3 << 24;
/// This message's id, so another message to the port is told apart.
const MESSAGE_ID: i32 = 0x6465_736b; // "desk"

#[link(name = "bsm", kind = "dylib")]
unsafe extern "C" {
    fn audit_token_to_pid(token: audit_token_t) -> libc::pid_t;
}

/// One right and the IOSurfaceID it is for.
#[repr(C)]
struct Message {
    header: mach_msg_header_t,
    body: mach_msg_body_t,
    port: mach_msg_port_descriptor_t,
    id: u32,
}

#[repr(C)]
struct Received {
    message: Message,
    trailer: mach_msg_audit_trailer_t,
}

/// An IOSurface this process holds a reference to.
pub type IoSurface = CFRetained<IOSurfaceRef>;

fn kern(what: &str, code: i32) -> io::Error {
    io::Error::other(format!("{what} failed ({code:#x})"))
}

/// The desk's port for one process's rights.
pub struct PortService {
    name: String,
    port: mach_port_t,
}

// SAFETY: a port name is a number in this task's space; receiving on it from any thread is fine.
unsafe impl Send for PortService {}
unsafe impl Sync for PortService {}

impl PortService {
    /// Check in a new port under a name of this process's own.
    pub fn check_in() -> io::Result<PortService> {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let n = NEXT.fetch_add(1, Ordering::SeqCst);
        let name = format!("ai.endue.desk.surface.{}.{n}", std::process::id());
        let c_name = CString::new(name.clone()).map_err(io::Error::other)?;
        let mut port: mach_port_t = MACH_PORT_NULL;
        // SAFETY: a NUL-terminated name and a place for the port the call makes.
        let kr = unsafe { bootstrap_check_in(bootstrap_port, c_name.as_ptr(), &mut port) };
        if kr != KERN_SUCCESS {
            return Err(kern("bootstrap_check_in", kr));
        }
        Ok(PortService { name, port })
    }

    /// The bootstrap name the process looks up.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The next right on the port, within `timeout`: the IOSurface it names and its id. Refused
    /// (`PermissionDenied`) unless process `pid` sent it and the IOSurface has the id it says.
    pub fn receive(
        &self,
        pid: u32,
        timeout: Duration,
    ) -> io::Result<(u32, CFRetained<IOSurfaceRef>)> {
        // SAFETY: zeroed is a valid bit pattern for these plain C structs.
        let mut received: Received = unsafe { std::mem::zeroed() };
        let ms = timeout.as_millis().min(u32::MAX as u128) as u32;
        // SAFETY: the buffer is as large as the size given and lives through the call.
        let kr = unsafe {
            mach_msg(
                &mut received.message.header,
                MACH_RCV_MSG | MACH_RCV_TIMEOUT | RCV_AUDIT,
                0,
                std::mem::size_of::<Received>() as u32,
                self.port,
                ms,
                MACH_PORT_NULL,
            )
        };
        if kr == MACH_RCV_TIMED_OUT {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "no right came"));
        }
        if kr != KERN_SUCCESS {
            return Err(kern("mach_msg receive", kr));
        }
        let message = &received.message;
        let complex = message.header.msgh_bits & MACH_MSGH_BITS_COMPLEX != 0;
        let one = message.body.msgh_descriptor_count == 1
            && u32::from(message.port.type_) == MACH_MSG_PORT_DESCRIPTOR;
        if !complex || !one || message.header.msgh_id != MESSAGE_ID {
            // SAFETY: frees whatever rights the message brought.
            unsafe { mach2::message::mach_msg_destroy(&mut received.message.header) };
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "not a right message",
            ));
        }
        let right = message.port.name;
        let id = message.id;
        // SAFETY: the trailer was asked for and filled in by the kernel.
        let sender = unsafe { audit_token_to_pid(received.trailer.msgh_audit) };
        let surface = (sender as u32 == pid)
            .then(|| IOSurfaceRef::lookup_from_mach_port(right))
            .flatten();
        // SAFETY: the right is this task's; the IOSurface, if any, holds its own reference.
        unsafe { mach_port_deallocate(mach_task_self(), right) };
        match surface {
            Some(surface) if surface.id() == id => Ok((id, surface)),
            Some(_) => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "the right's IOSurface is not the one its message names",
            )),
            None if sender as u32 != pid => Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("a right from process {sender}, not {pid}"),
            )),
            None => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "not an IOSurface's right",
            )),
        }
    }
}

impl Drop for PortService {
    fn drop(&mut self) {
        // SAFETY: the receive right is this service's; dropping it ends the name too.
        unsafe { mach_port_mod_refs(mach_task_self(), self.port, MACH_PORT_RIGHT_RECEIVE, -1) };
    }
}

/// A plugin's end: the desk's port, looked up by the name in its environment.
pub struct PortSender {
    port: mach_port_t,
}

// SAFETY: a send right's name, usable from any thread.
unsafe impl Send for PortSender {}
unsafe impl Sync for PortSender {}

impl PortSender {
    pub fn look_up(name: &str) -> io::Result<PortSender> {
        let c_name = CString::new(name).map_err(io::Error::other)?;
        let mut port: mach_port_t = MACH_PORT_NULL;
        // SAFETY: a NUL-terminated name and a place for the right.
        let kr = unsafe { bootstrap_look_up(bootstrap_port, c_name.as_ptr(), &mut port) };
        if kr != KERN_SUCCESS {
            return Err(kern("bootstrap_look_up", kr));
        }
        Ok(PortSender { port })
    }

    /// Send `surface`'s right to the desk, before the line that names it.
    pub fn send(&self, surface: &IOSurfaceRef) -> io::Result<()> {
        let right = surface.create_mach_port();
        let mut message = Message {
            header: mach_msg_header_t {
                msgh_bits: MACH_MSG_TYPE_COPY_SEND | MACH_MSGH_BITS_COMPLEX,
                msgh_size: std::mem::size_of::<Message>() as u32,
                msgh_remote_port: self.port,
                msgh_local_port: MACH_PORT_NULL,
                msgh_voucher_port: MACH_PORT_NULL,
                msgh_id: MESSAGE_ID,
            },
            body: mach_msg_body_t {
                msgh_descriptor_count: 1,
            },
            port: mach_msg_port_descriptor_t::new(right, MACH_MSG_TYPE_MOVE_SEND),
            id: surface.id(),
        };
        // SAFETY: a complex message of the size given; the right moves to the desk.
        let kr = unsafe {
            mach_msg(
                &mut message.header,
                MACH_SEND_MSG | MACH_SEND_TIMEOUT,
                std::mem::size_of::<Message>() as u32,
                0,
                MACH_PORT_NULL,
                5_000,
                MACH_PORT_NULL,
            )
        };
        if kr != KERN_SUCCESS {
            // SAFETY: the right stayed ours when the send failed.
            unsafe { mach_port_deallocate(mach_task_self(), right) };
            return Err(kern("mach_msg send", kr));
        }
        Ok(())
    }
}

impl Drop for PortSender {
    fn drop(&mut self) {
        // SAFETY: the send right is this sender's.
        unsafe { mach_port_deallocate(mach_task_self(), self.port) };
    }
}

/// A new BGRA IOSurface of `width` x `height` pixels, of this process alone (not global).
pub fn bgra_surface(width: u32, height: u32) -> Option<CFRetained<IOSurfaceRef>> {
    use objc2_core_foundation::{CFDictionary, CFNumber, CFString};
    use objc2_io_surface::{
        kIOSurfaceBytesPerElement, kIOSurfaceHeight, kIOSurfacePixelFormat, kIOSurfaceWidth,
    };
    // SAFETY: the keys are IOSurface's own constants.
    let keys: [&CFString; 4] = unsafe {
        [
            kIOSurfaceWidth,
            kIOSurfaceHeight,
            kIOSurfaceBytesPerElement,
            kIOSurfacePixelFormat,
        ]
    };
    let bgra = u32::from_be_bytes(*b"BGRA") as i32;
    let values = [
        CFNumber::new_i32(width as i32),
        CFNumber::new_i32(height as i32),
        CFNumber::new_i32(4),
        CFNumber::new_i32(bgra),
    ];
    let values: Vec<&CFNumber> = values.iter().map(|v| &**v).collect();
    let properties = CFDictionary::<CFString, CFNumber>::from_slices(&keys, &values);
    // SAFETY: a dictionary of IOSurface creation properties.
    unsafe { IOSurfaceRef::new(properties.as_opaque()) }
}

#[cfg(test)]
mod tests {
    use super::{PortSender, PortService, bgra_surface};
    use std::time::Duration;

    #[test]
    fn a_right_reaches_the_desks_port_only_from_the_process_it_expects() {
        let service = PortService::check_in().expect("a port under a bootstrap name");
        let sender = PortSender::look_up(service.name()).expect("the name looks up");
        let surface = bgra_surface(64, 32).expect("an IOSurface");
        sender.send(&surface).unwrap();
        let me = std::process::id();
        let (id, got) = service.receive(me, Duration::from_secs(2)).unwrap();
        assert_eq!(
            (id, got.id(), got.width()),
            (surface.id(), surface.id(), 64)
        );
        sender.send(&surface).unwrap();
        let other = service.receive(me + 1, Duration::from_secs(2));
        assert_eq!(
            other.err().map(|e| e.kind()),
            Some(std::io::ErrorKind::PermissionDenied),
            "a right from a process the desk did not start"
        );
        let none = service.receive(me, Duration::from_millis(20));
        assert_eq!(
            none.err().map(|e| e.kind()),
            Some(std::io::ErrorKind::TimedOut)
        );
    }
}
