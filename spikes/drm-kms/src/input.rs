//! Input without a windowing system: libinput reads the seat's evdev nodes (opened through the
//! seat, so logind can revoke them on a VT switch) and does pointer acceleration, tap-to-click and
//! scroll sources; xkbcommon applies the keyboard layout. The result is desk-compositor's own
//! [`Input`], the type its `InputRouter` takes from any shell (ADR 0150). No key repeat (a
//! compositor runs its own repeat timer) and no input method (see README).

use crate::keys;
use crate::seat::Seat;
use desk_compositor::input::{Button, Input, KeyInput, Modifiers};
use desk_surface::generated::SurfaceWheelUnit;
use input::event::keyboard::{KeyState, KeyboardEventTrait};
use input::event::pointer::{Axis, ButtonState, PointerEvent, PointerScrollEvent};
use input::event::{Event, KeyboardEvent};
use input::{Libinput, LibinputInterface};
use std::cell::RefCell;
use std::os::fd::{AsFd, BorrowedFd, OwnedFd};
use std::path::Path;
use std::rc::Rc;
use xkbcommon::xkb;

pub type SharedSeat = Rc<RefCell<Box<dyn Seat>>>;

/// What the main loop does with an event.
pub enum Action {
    Input(Input),
    SwitchVt(u32),
    Quit,
}

/// libinput opens and closes evdev nodes through this, so the seat hands them out.
struct Opener(SharedSeat);

impl LibinputInterface for Opener {
    fn open_restricted(&mut self, path: &Path, _flags: i32) -> Result<OwnedFd, i32> {
        self.0.borrow_mut().open(path).map_err(|e| {
            eprintln!("input: {}: {e}", path.display());
            -e.raw_os_error().unwrap_or(13)
        })
    }
    fn close_restricted(&mut self, fd: OwnedFd) {
        self.0.borrow_mut().close(fd);
    }
}

pub struct Devices {
    libinput: Libinput,
    state: xkb::State,
    pointer: (f64, f64),
    bounds: (f64, f64),
    mods: Modifiers,
}

impl Devices {
    pub fn new(seat: SharedSeat, size: (u32, u32)) -> Result<Devices, String> {
        let libinput = open_libinput(seat)?;
        // Empty RMLVO names mean the XKB_DEFAULT_{RULES,MODEL,LAYOUT,VARIANT,OPTIONS} environment
        // or evdev/pc105/us: `XKB_DEFAULT_LAYOUT=kr desk-kms` for a Korean layout.
        let context = xkb::Context::new(xkb::CONTEXT_NO_FLAGS);
        let keymap = xkb::Keymap::new_from_names(
            &context,
            "",
            "",
            "",
            "",
            None,
            xkb::KEYMAP_COMPILE_NO_FLAGS,
        )
        .ok_or("xkbcommon: no keymap (is xkb-data installed?)")?;
        let state = xkb::State::new(&keymap);
        let bounds = (f64::from(size.0), f64::from(size.1));
        Ok(Devices {
            libinput,
            state,
            pointer: (bounds.0 / 2.0, bounds.1 / 2.0),
            bounds,
            mods: Modifiers::default(),
        })
    }

    pub fn fd(&self) -> BorrowedFd<'_> {
        self.libinput.as_fd()
    }

    pub fn pointer(&self) -> (f32, f32) {
        (self.pointer.0 as f32, self.pointer.1 as f32)
    }

    /// VT switch away: libinput closes every node (logind revoked them anyway).
    pub fn suspend(&mut self) {
        self.libinput.suspend();
    }

    pub fn resume(&mut self) {
        if self.libinput.resume().is_err() {
            eprintln!("input: libinput could not reopen its devices");
        }
    }

    /// Everything libinput has read since the last call.
    pub fn dispatch(&mut self) -> Vec<Action> {
        if let Err(e) = self.libinput.dispatch() {
            eprintln!("input: dispatch: {e}");
        }
        let mut out = vec![];
        let events: Vec<Event> = (&mut self.libinput).collect();
        for event in events {
            match event {
                Event::Pointer(p) => self.pointer_event(p, &mut out),
                Event::Keyboard(KeyboardEvent::Key(k)) => {
                    self.key(k.key(), k.key_state() == KeyState::Pressed, &mut out)
                }
                Event::Device(d) => println!("input: device event {d:?}"),
                _ => {}
            }
        }
        out
    }

    fn pointer_event(&mut self, event: PointerEvent, out: &mut Vec<Action>) {
        match event {
            PointerEvent::Motion(m) => {
                let (x, y) = self.pointer;
                self.pointer = (
                    (x + m.dx()).clamp(0.0, self.bounds.0 - 1.0),
                    (y + m.dy()).clamp(0.0, self.bounds.1 - 1.0),
                );
                self.moved(out);
            }
            // Tablets and VMs' absolute pointers (QEMU's usb-tablet, virtio-tablet).
            PointerEvent::MotionAbsolute(m) => {
                self.pointer = (
                    m.absolute_x_transformed(self.bounds.0 as u32),
                    m.absolute_y_transformed(self.bounds.1 as u32),
                );
                self.moved(out);
            }
            PointerEvent::Button(b) => {
                let button = match b.button() {
                    0x110 => Button::Left,
                    0x111 => Button::Right,
                    0x112 => Button::Middle,
                    0x113 => Button::Back,
                    0x114 => Button::Forward,
                    _ => return,
                };
                let pressed = b.button_state() == ButtonState::Pressed;
                out.push(Action::Input(Input::PointerButton { button, pressed }));
            }
            // A wheel: 120 per notch, one line each, positive down as the DOM's.
            PointerEvent::ScrollWheel(w) => {
                let v = |axis| {
                    if w.has_axis(axis) {
                        w.scroll_value_v120(axis) / 120.0
                    } else {
                        0.0
                    }
                };
                let (dx, dy) = (v(Axis::Horizontal), v(Axis::Vertical));
                out.push(Action::Input(Input::Wheel {
                    dx,
                    dy,
                    unit: SurfaceWheelUnit::Line,
                }));
            }
            // Touchpads and button scrolling: libinput's units are about a pixel.
            PointerEvent::ScrollFinger(f) => {
                let v = |axis| {
                    if f.has_axis(axis) {
                        f.scroll_value(axis)
                    } else {
                        0.0
                    }
                };
                out.push(Action::Input(Input::Wheel {
                    dx: v(Axis::Horizontal),
                    dy: v(Axis::Vertical),
                    unit: SurfaceWheelUnit::Pixel,
                }));
            }
            _ => {}
        }
    }

    fn moved(&self, out: &mut Vec<Action>) {
        let (x, y) = self.pointer();
        out.push(Action::Input(Input::PointerMoved { x, y }));
    }

    fn key(&mut self, code: u32, pressed: bool, out: &mut Vec<Action>) {
        // XKB keycodes are evdev codes plus 8, a leftover of X11's minimum keycode.
        let keycode = xkb::Keycode::new(code + 8);
        let sym = self.state.key_get_one_sym(keycode);
        let text = self.state.key_get_utf8(keycode);
        self.state.update_key(
            keycode,
            if pressed {
                xkb::KeyDirection::Down
            } else {
                xkb::KeyDirection::Up
            },
        );
        let active = |name: &str| {
            self.state
                .mod_name_is_active(name, xkb::STATE_MODS_EFFECTIVE)
        };
        let mods = Modifiers {
            shift: active(xkb::MOD_NAME_SHIFT),
            ctrl: active(xkb::MOD_NAME_CTRL),
            alt: active(xkb::MOD_NAME_ALT),
            meta: active(xkb::MOD_NAME_LOGO),
            caps_lock: active(xkb::MOD_NAME_CAPS),
        };
        if pressed {
            if let Some(vt) = keys::switch_vt(sym.raw()) {
                out.push(Action::SwitchVt(vt));
                return;
            }
            if code == 14 && self.mods.ctrl && self.mods.alt {
                out.push(Action::Quit);
                return;
            }
        }
        let printable = !text.is_empty() && !text.chars().any(char::is_control);
        let key = if printable {
            text.clone()
        } else {
            keys::dom_key_from_keysym(&xkb::keysym_get_name(sym))
        };
        out.push(Action::Input(Input::Key(KeyInput {
            key,
            code: keys::dom_code(code),
            text: (pressed && printable).then_some(text),
            pressed,
            repeat: false,
        })));
        if mods != self.mods {
            self.mods = mods;
            out.push(Action::Input(Input::Modifiers(mods)));
        }
    }
}

#[cfg(feature = "udev")]
fn open_libinput(seat: SharedSeat) -> Result<Libinput, String> {
    // udev enumerates the seat's devices and reports hotplugged ones.
    let mut libinput = Libinput::new_with_udev(Opener(seat));
    libinput
        .udev_assign_seat(&std::env::var("XDG_SEAT").unwrap_or_else(|_| "seat0".into()))
        .map_err(|()| "libinput: udev_assign_seat failed")?;
    Ok(libinput)
}

#[cfg(not(feature = "udev"))]
fn open_libinput(seat: SharedSeat) -> Result<Libinput, String> {
    // The path backend: every /dev/input/event* now, no hotplug (`--features udev` has it).
    let mut libinput = Libinput::new_from_path(Opener(seat));
    let mut nodes: Vec<_> = std::fs::read_dir("/dev/input")
        .map_err(|e| format!("/dev/input: {e}"))?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("event"))
        })
        .collect();
    nodes.sort();
    let added = nodes
        .iter()
        .filter(|p| libinput.path_add_device(&p.to_string_lossy()).is_some())
        .count();
    println!(
        "input: libinput path backend, {added} of {} evdev nodes",
        nodes.len()
    );
    Ok(libinput)
}
