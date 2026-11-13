//! The text field's menu (#156). An off-screen browser has no menu of its own: CEF asks its
//! embedder for one (`RunContextMenu`) and otherwise drops it ("Default context menu implementation
//! is not available"), so a right click in a field opened nothing. CEF asks only when the page did
//! not cancel the `contextmenu` event, so a page that draws its own menu keeps it. For an editable
//! field (Undo, Redo, Cut, Copy, Paste, Select All, as its edit state allows) or selected text
//! (Copy), the shell places a menu in the desk's look in that page (`field_menu_model.rs`), the
//! page draws it where the shell placed it (`field_menu.js`), and while it shows the shell takes
//! every press, wheel and key that would reach the page (`take`): a press on an item continues
//! CEF's menu with that item's command, which CEF runs on the frame that asked. The page never
//! chooses: a click is the shell's to judge, by its own geometry. One menu shows at a time, and a
//! press in another plugin's page, or the page losing the keys, puts it away.

#[path = "field_menu_client.rs"]
mod client;
#[path = "field_menu_model.rs"]
mod model;

use std::cell::{Cell, RefCell};

use cef::*;
use desk_surface::generated::{CompositorMessage as M, SurfacePointerButton};
use serde_json::Value;

use super::view::SharedView;
use model::{Entry, Input, Open, Placed, Then};

const DRAW: &str = include_str!("field_menu.js");

/// The menu that shows: the browser it is in, the frame it is drawn in, CEF's callback.
struct Shown {
    browser: i32,
    frame: Frame,
    callback: RunContextMenuCallback,
    open: Open,
}

thread_local! {
    // CEF calls the handler and the input arrives on its UI thread.
    static SHOWN: RefCell<Option<Shown>> = const { RefCell::new(None) };
    /// The release of the press that put the menu away: the menu's too.
    static SWALLOW: Cell<Option<(i32, SurfacePointerButton)>> = const { Cell::new(None) };
}

/// `inner`, the client of the off-screen browser whose view is `view`, with the field menu.
pub fn client(inner: Client, view: SharedView) -> Client {
    client::WithMenu::new(inner, FieldMenus::new(view))
}

wrap_context_menu_handler! {
    pub struct FieldMenus {
        view: SharedView,
    }

    impl ContextMenuHandler {
        fn run_context_menu(
            &self,
            browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            params: Option<&mut ContextMenuParams>,
            _model: Option<&mut MenuModel>,
            callback: Option<&mut RunContextMenuCallback>,
        ) -> ::std::os::raw::c_int {
            let (Some(browser), Some(params), Some(callback)) = (browser, params, callback) else {
                return 0;
            };
            // Nothing to edit or copy: no menu, as before (and no line in the log for it).
            let Some(entries) = entries(params) else {
                callback.cancel();
                return 1;
            };
            let view = {
                let view = self.view.lock();
                (f64::from(view.size.0), f64::from(view.size.1))
            };
            let at = (f64::from(params.xcoord()), f64::from(params.ycoord()));
            show(browser, callback.clone(), model::place(entries, at, view), at);
            1
        }
    }
}

/// The menu's items for what was right-clicked, if it gets one.
fn entries(params: &ContextMenuParams) -> Option<Vec<Entry>> {
    let mac = cfg!(target_os = "macos");
    if params.is_editable() == 1 {
        let flags: cef::sys::cef_context_menu_edit_state_flags_t = params.edit_state_flags().into();
        return Some(model::field(flags.0, mac));
    }
    let selected = CefString::from(&params.selection_text()).to_string();
    (!selected.trim().is_empty()).then(|| model::selection(mac))
}

fn show(browser: &Browser, callback: RunContextMenuCallback, placed: Placed, at: (f64, f64)) {
    if let Some(earlier) = SHOWN.with(|s| s.borrow_mut().take()) {
        finish(earlier, None);
    }
    let Some(frame) = browser.main_frame() else {
        callback.cancel();
        return;
    };
    let open = Open::new(placed, at);
    draw(&frame, Some(&open));
    let shown = Shown {
        browser: browser.identifier(),
        frame,
        callback,
        open,
    };
    SHOWN.with(|s| *s.borrow_mut() = Some(shown));
}

/// Draw the menu in `frame` (`None`: take it away).
fn draw(frame: &Frame, open: Option<&Open>) {
    let spec = open.map_or(Value::Null, |o| o.placed.spec(o.hover));
    let code = format!("({})({spec});", DRAW.trim_end().trim_end_matches(';'));
    let url = "desk-shell://field-menu.js";
    frame.execute_java_script(Some(&code.as_str().into()), Some(&url.into()), 1);
}

/// Put the menu away, continuing CEF's menu with `chosen` or cancelling it.
fn finish(shown: Shown, chosen: Option<i32>) {
    draw(&shown.frame, None);
    match chosen {
        Some(command) => shown.callback.cont(command, EventFlags::default()),
        None => shown.callback.cancel(),
    }
}

/// What the menu hears of `message`; `None` for what is never its.
fn input_of(message: &M) -> Option<Input<'_>> {
    let right = |b: SurfacePointerButton| b == SurfacePointerButton::Right;
    Some(match message {
        M::SurfacePointerMove(m) => Input::Move(m.x, m.y),
        M::SurfacePointerDown(m) => Input::Down {
            x: m.x,
            y: m.y,
            right: right(m.button),
        },
        M::SurfacePointerUp(m) => Input::Up {
            x: m.x,
            y: m.y,
            right: right(m.button),
        },
        M::SurfacePointerWheel(_) => Input::Wheel,
        M::SurfacePointerLeave(_) => Input::Leave,
        M::SurfaceKeyDown(k) => Input::Key(&k.key),
        M::SurfaceKeyUp(_) => Input::KeyUp,
        M::SurfaceKeyChar(_) | M::SurfaceImeComposition(_) => Input::Typed,
        M::SurfaceFocusOut(_) => Input::Blur,
        _ => return None,
    })
}

/// Whether `message`, input for `host`'s page, is the menu's: then the page never hears it.
pub fn take(host: &BrowserHost, message: &M) -> bool {
    let Some(id) = host.browser().map(|b| b.identifier()) else {
        return false;
    };
    if let M::SurfacePointerUp(up) = message
        && SWALLOW.with(|s| s.get()) == Some((id, up.button))
    {
        SWALLOW.with(|s| s.set(None));
        return true;
    }
    let Some(input) = input_of(message) else {
        return false;
    };
    let heard = SHOWN.with(|s| {
        let mut shown = s.borrow_mut();
        let shown = shown.as_mut()?;
        if shown.browser != id {
            // A press in another plugin's page puts the menu away; that page has the press. The
            // runtime's pages hear every press under the windows they hold, the menu's included:
            // the desk's, and a window's own (ADR 0201), which hears its plugins' left presses.
            let press = matches!(input, Input::Down { .. } | Input::Wheel | Input::Key(_));
            let runtime = super::top::is_shell_page(id) || super::window_pages::is_page_browser(id);
            let away = press && !runtime;
            return Some(if away { Then::Dismiss } else { Then::Pass });
        }
        Some(shown.open.hear(input))
    });
    let mine = SHOWN.with(|s| s.borrow().as_ref().is_some_and(|s| s.browser == id));
    match heard {
        None | Some(Then::Pass) => false,
        Some(Then::Take) => true,
        Some(Then::Redraw) => {
            let shown = SHOWN.with(|s| {
                (s.borrow().as_ref()).map(|shown| (shown.frame.clone(), shown.open.clone()))
            });
            if let Some((frame, open)) = shown {
                draw(&frame, Some(&open));
            }
            true
        }
        Some(Then::Choose(command)) => {
            if let Some(shown) = SHOWN.with(|s| s.borrow_mut().take()) {
                finish(shown, Some(command));
            }
            true
        }
        Some(Then::Dismiss) => {
            if let Some(shown) = SHOWN.with(|s| s.borrow_mut().take()) {
                finish(shown, None);
            }
            if !mine {
                return false;
            }
            if let M::SurfacePointerDown(down) = message {
                SWALLOW.with(|s| s.set(Some((id, down.button))));
            }
            // The page loses the keys as it would have without the menu.
            !matches!(input, Input::Blur)
        }
    }
}
