//! Window pages: each window's own document, drawn from a texture of its own. The runtime opens one
//! for every window it lays out (`window.open` with the name `desk-window:<window id>`, ADR 0201):
//! a same-origin popup of the desk's page, so the runtime's one script and state build the window's
//! title bar and its own views in it, and its browser renders off screen into a shared texture as a
//! plugin surface's does. The web host keeps it as surface `window:<window id>`: on the desk's frame
//! clock, its input routed to it, its paints attached, laid out at its window's size, hidden with
//! its window. Moving a window moves the texture and repaints nothing, and no window's picture
//! shares a texture with another's or with the desk's page. A window page makes no bridge calls and
//! posts to no one: the runtime's script that fills it calls from the desk's page.

use std::sync::Arc;

use cef::*;

use super::lifecycle::{Action, State};
use super::render::popup_room::{Shown, look_later};
use super::view::{SharedView, View};
use super::{DEFAULT_PACE, Record, WebHost, client, drag, frames, render};

/// The popup name a window page opens under: this, then the window's id.
pub const NAME: &str = "desk-window:";
/// The DevTools protocol's focus emulation, on and off (`window_page_focus`).
const FOCUSED: &[u8] =
    br#"{"id":1,"method":"Emulation.setFocusEmulationEnabled","params":{"enabled":true}}"#;
const UNFOCUSED: &[u8] =
    br#"{"id":2,"method":"Emulation.setFocusEmulationEnabled","params":{"enabled":false}}"#;
/// A see-through base under the page (`adopted`): a popup's view keeps Chromium's opaque canvas
/// (white, or #121212 for a dark colour scheme) whatever background its settings name, which hid
/// the window's frame the compositor draws under it, its border and the focused one's colour.
const CLEAR_BASE: &[u8] = br#"{"id":3,"method":"Emulation.setDefaultBackgroundColorOverride","params":{"color":{"r":0,"g":0,"b":0,"a":0}}}"#;
/// A window page's surface id: this, then the window's id.
pub const SURFACE: &str = "window:";

/// The window a popup named `name` is the page of, if it is one.
pub fn window_of(name: &str) -> Option<&str> {
    name.strip_prefix(NAME).filter(|id| !id.is_empty())
}

/// Window `window`'s page's surface id.
pub fn surface_of(window: &str) -> String {
    format!("{SURFACE}{window}")
}

/// Whether surface `surface` is a window page.
pub fn is_window_page(surface: &str) -> bool {
    surface.starts_with(SURFACE)
}

/// The browsers that are windows' own pages now.
static BROWSERS: std::sync::Mutex<std::collections::BTreeSet<i32>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

/// Browser `id`, made for `surface`, is a window's own page from now on: only a window page's is.
/// Every surface's browser was once kept so, and a plugin's never left: a press in another plugin
/// then counted as one in the desk's page, and the field menu stayed open (`field_menu.rs`).
fn adopt_browser(surface: &str, id: i32) -> bool {
    let page = is_window_page(surface);
    if page {
        known(id, true);
    }
    page
}

/// Browser `id` is a window's own page (`true`), or no more.
fn known(id: i32, page: bool) {
    let mut browsers = BROWSERS.lock().unwrap_or_else(|e| e.into_inner());
    if page {
        browsers.insert(id);
    } else {
        browsers.remove(&id);
    }
}

/// Whether browser `id` is a window's own page: the runtime's, as the desk's page is, and so it
/// hears a press on a plugin in its window with that plugin (`field_menu.rs`).
pub fn is_page_browser(id: i32) -> bool {
    BROWSERS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(&id)
}

/// Where a window page lies now: its window's size (logical pixels), its scale, whether it shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub surface: String,
    pub size: (u32, u32),
    pub scale: f32,
    pub hidden: bool,
}

impl WebHost {
    /// The client of the page the desk's page opens for window `window` at `size`, which the host
    /// keeps from now on; the settings and window info of its browser are set here too. A page the
    /// window had still (the runtime opens one only once it lost the last, which may still be
    /// closing) closes: the new one takes the surface.
    pub fn window_page(
        &self,
        window: &str,
        size: (u32, u32),
        info: &mut WindowInfo,
        settings: &mut BrowserSettings,
    ) -> Option<Client> {
        let surface = surface_of(window);
        let scale = self
            .inner()
            .page
            .as_ref()
            .map_or(1.0, |p| p.view.lock().scale);
        let view = SharedView::new(View::new(&surface, size, scale, false));
        let before = {
            let mut inner = self.inner();
            inner.records.insert(
                surface.clone(),
                Record {
                    plugin: String::new(),
                    state: State::Live { hidden: false },
                    view: view.clone(),
                    browser: None,
                    pacing: frames::Pacing::new(DEFAULT_PACE),
                    drag: drag::DragIds::default(),
                    composing: None,
                },
            )
        };
        if let Some(host) = before.and_then(|r| r.browser).and_then(|b| b.host()) {
            host.close_browser(1);
        }
        info.windowless_rendering_enabled = 1;
        info.shared_texture_enabled = i32::from(self.shared_textures);
        info.external_begin_frame_enabled = 1;
        // Transparent where it paints nothing: the compositor draws the window's frame under it.
        settings.windowless_frame_rate = DEFAULT_PACE as i32;
        settings.background_color = 0;
        view.lock().restart();
        let render = render::SurfaceRender::new(view.clone(), Arc::clone(&self.sink), self.room());
        let page = client::window_page(self, &surface, render);
        Some(super::field_menu::client(page, view))
    }

    /// A browser for `surface` was made by its page's opener rather than by the host: it is the
    /// surface's from now on.
    pub fn adopted(&self, surface: &str, browser: &Browser) {
        if !adopt_browser(surface, browser.identifier()) {
            return;
        }
        if let Some(record) = self.inner().records.get_mut(surface)
            && record.browser.is_none()
        {
            record.browser = Some(browser.clone());
        }
        if let Some(host) = browser.host() {
            host.send_dev_tools_message(Some(CLEAR_BASE));
        }
    }

    /// Lay every window page out at its window, and hide those whose window is not drawn. A page
    /// shown has the engine's focus from then on, as the desk's page does: one without it fires no
    /// focus event, so the focus the runtime moves into it (Ctrl+Tab to a plugin's place there, a
    /// field) would go unheard. The keys go where the compositor routes them, whatever has it.
    /// A page shown again (its desktop in front again, its window back from the drawer) that
    /// painted before is looked at `LOOK` on, as after a popup's room (`popup_room.rs`): five to
    /// seven of fourteen pages hidden together came back without frames for good (ADR 0201).
    pub fn place_window_pages(&self, placed: &[Placed]) {
        let now = std::time::Instant::now();
        let mut acts = Vec::new();
        let mut again = Vec::new();
        {
            let mut inner = self.inner();
            let pages = inner
                .records
                .iter_mut()
                .filter(|(s, r)| is_window_page(s) && matches!(r.state, State::Live { .. }));
            for (surface, record) in pages {
                let at = placed.iter().find(|p| &p.surface == surface);
                let mut view = record.view.lock();
                let (size, scale) = at.map_or((view.size, view.scale), |p| (p.size, p.scale));
                let hidden = at.is_none_or(|p| p.hidden);
                let resized = view.size != size || view.scale != scale;
                let shown_again = view.hidden != hidden;
                view.size = size;
                view.scale = scale;
                view.hidden = hidden;
                drop(view);
                record.state = State::Live { hidden };
                if resized || shown_again {
                    record.pacing.heard(now);
                }
                let browser = record.browser.as_ref().map(Browser::identifier);
                if shown_again
                    && !hidden
                    && let Some(page) = browser.and_then(|b| Shown::of(surface, b, &record.view))
                {
                    again.push(page);
                }
                for (due, action) in [
                    (resized, Action::Resize),
                    (shown_again, Action::Hide(hidden)),
                ] {
                    if due {
                        acts.push((
                            surface.clone(),
                            action,
                            record.view.clone(),
                            record.browser.clone(),
                        ));
                    }
                }
            }
        }
        for (surface, action, view, browser) in acts {
            self.act(&surface, action, &view, browser.as_ref(), DEFAULT_PACE);
        }
        look_later(Arc::downgrade(&self.inner), again, "its window shown again");
    }

    /// Window page `surface` has the keys now (`focused`), or no more: its page has the engine's
    /// focus while it has them. An off-screen popup's widget never takes it from `SetFocus`, and a
    /// page without it shows no caret and draws a selection greyed, so the DevTools protocol's
    /// focus emulation gives it; only while the keys are there, as it ends a plugin's open popup.
    pub fn window_page_focus(&self, surface: &str, focused: bool) {
        let Some(host) = self.browser(surface).and_then(|b| b.host()) else {
            return;
        };
        host.send_dev_tools_message(Some(if focused { FOCUSED } else { UNFOCUSED }));
    }

    /// Window page `surface` stopped painting for good (`why`), whatever its page asks: the host
    /// forgets it and closes its browser, and its window, back in the desk's page, opens a page
    /// anew (`window-pages.ts`). Loading it again would leave a blank page: the runtime built it.
    pub fn replace_window_page(&self, surface: &str, why: &str) {
        let gone = {
            let mut inner = self.inner();
            let id = (inner.records.get(surface))
                .and_then(|r| r.browser.as_ref())
                .map(Browser::identifier);
            id.and_then(|id| forget(&mut inner, surface, id))
        };
        if let Some(browser) = gone {
            close_replaced(surface, &browser, why);
        }
    }

    /// Window `window`'s page closed with its window: the host forgets it.
    pub fn window_page_closed(&self, surface: &str, browser: i32) {
        known(browser, false);
        let mut inner = self.inner();
        if inner
            .records
            .get(surface)
            .and_then(|r| r.browser.as_ref())
            .is_some_and(|b| b.identifier() == browser)
        {
            inner.records.remove(surface);
        }
    }
}

/// The host forgets window page `surface` while `browser` (its identifier) shows it: that
/// browser, to close once the host's lock is let go.
pub(super) fn forget(inner: &mut super::Inner, surface: &str, browser: i32) -> Option<Browser> {
    let shows = (inner.records.get(surface))
        .and_then(|r| r.browser.as_ref())
        .is_some_and(|b| b.identifier() == browser);
    if !shows {
        return None;
    }
    inner.records.remove(surface)?.browser
}

/// Close window page `surface`'s `browser`, which stopped painting (`why`): the runtime hears its
/// page go and opens its window's page anew (ADR 0201).
pub(super) fn close_replaced(surface: &str, browser: &Browser, why: &str) {
    eprintln!("endue Desk: surface {surface} {why}; its window opens a page anew (ADR 0201)");
    crate::frame_trace::line(
        "replaced",
        serde_json::json!({ "surface": surface, "why": why }),
    );
    if let Some(host) = browser.host() {
        host.close_browser(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_windows_page_browser_is_the_runtimes_until_it_closes() {
        // A press on a plugin's field menu reaches that window's page too: it must not put it away.
        assert!(!is_page_browser(-7));
        known(-7, true);
        assert!(is_page_browser(-7));
        known(-7, false);
        assert!(!is_page_browser(-7));
    }

    #[test]
    fn only_a_window_pages_browser_is_kept_as_one() {
        // A plugin surface's browser stays a plugin's: a press there is no press in the desk's page.
        assert!(!adopt_browser("main.endue-notes", -21));
        assert!(!is_page_browser(-21));
        assert!(adopt_browser(&surface_of("endue.notes"), -22));
        assert!(is_page_browser(-22));
        known(-22, false);
    }

    #[test]
    fn a_popup_is_a_window_page_by_its_name_alone() {
        assert_eq!(window_of("desk-window:local:claude"), Some("local:claude"));
        assert_eq!(window_of("desk-window:"), None, "no window");
        assert_eq!(window_of("_blank"), None);
        assert_eq!(window_of("desk-windowx"), None);
        assert_eq!(surface_of("notes"), "window:notes");
        assert!(is_window_page(&surface_of("endue-agent:ag_1")));
        assert!(
            !is_window_page("main.endue-notes"),
            "a plugin surface's host"
        );
    }
}
