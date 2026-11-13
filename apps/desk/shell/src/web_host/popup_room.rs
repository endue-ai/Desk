//! Room for a popup widget's first frame (#156). Chromium keeps at most a handful of browsers'
//! frames (its `FrameEvictionManager`: five, more with memory to spare), never evicting a shown
//! one, and CEF's off-screen view embeds a new popup's first surface while that surface is still
//! counted as hidden (`ShowWithVisibility` marks the view showing, then synchronises it, then tells
//! its frame host it is shown). On a desk that shows five browsers or more the popup's frame is
//! evicted the moment it is embedded, its renderer is never given a surface id to draw into, and
//! the list or the picker never paints, though it is open and takes the keys. Nothing in CEF's API
//! reaches a popup's view to give it a new id afterwards.
//!
//! So when a page's popup opens (`on_popup_show`, which CEF calls before it shows the popup), every
//! other shown browser is hidden for that moment, which hands Chromium their frames to evict (the
//! compositor keeps its own copy of each surface's last frame, so nothing changes on screen), and
//! the popup's frame is kept. On the next turn of CEF's loop each of them is shown again and laid
//! out and painted anew, as a surface shown again after others is (`Action::Hide(false)`). A
//! surface the compositor hid or put to sleep meanwhile stays as it is now. The desk's own page
//! stays shown: it is not one of the host's surfaces.
//!
//! A window's own page (ADR 0201) does not always come back: after the first popup of a desk with
//! its fourteen windows, five to seven of their pages took begin frames on every desk frame and
//! painted nothing again, nor ran a frame callback, nor heard a press (the title bar's drag did
//! nothing), and neither a later show, a resize, a delay before showing nor loading the page again
//! brought one back. So each window page shown again is put on the clock with the others, and
//! `LOOK` later every one that painted before and has painted nothing since is replaced: its
//! browser closes, and its window opens a page anew from the desk's page, which draws the window
//! meanwhile. Every page that came back had painted by then.

use std::sync::{Mutex, Weak};

use cef::*;

use super::super::lifecycle::State;
use super::super::view::SharedView;
use super::super::window_pages::{close_replaced, forget, is_window_page};
use super::super::{Inner, WebHost, frames};
use super::popup_screen::paints;

/// How long after a window page is shown again its paint must have come (the module's doc).
const LOOK: i64 = 500;

/// A way back to the host's surfaces from a surface's render handler; nothing once the host is gone.
#[derive(Clone)]
pub struct Room(Weak<Mutex<Inner>>);

impl WebHost {
    /// What a render handler makes room through.
    pub fn room(&self) -> Room {
        Room(std::sync::Arc::downgrade(&self.inner))
    }
}

/// Whether a surface in `state` has a frame Chromium keeps: a shown one with its renderer.
fn shown(state: State) -> bool {
    state == State::Live { hidden: false }
}

impl Room {
    /// Room for no surface: one whose host is gone.
    #[cfg(test)]
    pub fn none() -> Room {
        Room(Weak::new())
    }

    /// The browser `opener` (its identifier) opens a popup: hide every other shown browser now and
    /// show them again on the next turn of CEF's loop.
    pub fn make(&self, opener: i32) {
        let Some(inner) = self.0.upgrade() else {
            return;
        };
        // Never wait here: CEF may call while the host holds its lock further up the stack.
        let others: Vec<(String, Browser)> = {
            let Ok(inner) = inner.try_lock() else {
                return;
            };
            (inner.records.iter())
                .filter(|(_, r)| shown(r.state))
                .filter_map(|(s, r)| Some((s.clone(), r.browser.clone()?)))
                .filter(|(_, b)| b.identifier() != opener)
                .collect()
        };
        if others.is_empty() {
            return;
        }
        for (_, browser) in &others {
            if let Some(host) = browser.host() {
                host.was_hidden(1);
            }
        }
        let mut back = GiveBack::new(self.0.clone(), others);
        post_task(ThreadId::UI, Some(&mut back));
    }
}

wrap_task! {
    struct GiveBack {
        inner: Weak<Mutex<Inner>>,
        hidden: Vec<(String, Browser)>,
    }

    impl Task {
        fn execute(&self) {
            let still: Vec<(String, Browser, SharedView)> = {
                let Some(inner) = self.inner.upgrade() else { return };
                let inner = inner.lock().unwrap_or_else(|e| e.into_inner());
                (self.hidden.iter())
                    .filter_map(|(surface, browser)| {
                        let r = inner.records.get(surface)?;
                        let same = r.browser.as_ref().map(|b| b.identifier())
                            == Some(browser.identifier());
                        (shown(r.state) && same)
                            .then(|| (surface.clone(), browser.clone(), r.view.clone()))
                    })
                    .collect()
            };
            let mut pages = Vec::new();
            for (surface, browser, view) in still {
                if let Some(host) = browser.host() {
                    // As a surface shown again after others: its frame was evicted, so it lays out
                    // once more for a new surface id, and paints.
                    host.was_hidden(0);
                    host.was_resized();
                    host.invalidate(PaintElementType::VIEW);
                }
                // A window page that painted before is to paint again by `LOOK` (the module's doc).
                if is_window_page(&surface)
                    && let Some(page) = Shown::of(&surface, browser.identifier(), &view)
                {
                    frames::heard(browser.identifier(), false);
                    pages.push(page);
                }
            }
            look_later(self.inner.clone(), pages, "a popup's room");
        }
    }
}

/// A window page just shown again, as it was then: its surface, its browser, its paints and the
/// begin frames the clock had sent it.
#[derive(Clone)]
pub(in crate::web_host) struct Shown {
    surface: String,
    browser: i32,
    paints: u64,
    fed: u64,
    view: SharedView,
}

impl Shown {
    /// Window page `surface` (browser `browser`) shown again now, if it painted before: one that
    /// never painted is the stall watch's to judge (`stall.rs`).
    pub(in crate::web_host) fn of(surface: &str, browser: i32, view: &SharedView) -> Option<Shown> {
        let (paints, fed) = {
            let v = view.lock();
            (paints(&v), v.counts.begin_frames)
        };
        (paints > 0).then(|| Shown {
            surface: surface.to_owned(),
            browser,
            paints,
            fed,
            view: view.clone(),
        })
    }
}

/// Whether a window page shown again is to be replaced `LOOK` on: it is shown still, the clock gave
/// it begin frames meanwhile, and it painted nothing for them. A page hidden again, or one the
/// clock left without frames (the desk out of sight, asleep), is not judged.
pub(in crate::web_host) fn replace(shown_now: bool, paints: (u64, u64), fed: (u64, u64)) -> bool {
    shown_now && paints.1 == paints.0 && fed.1 > fed.0
}

/// Look `LOOK` from now at the window pages shown again after `after` (a popup's room, a window
/// shown again: `window_pages.rs`), and replace each that `replace` says.
pub(in crate::web_host) fn look_later(
    inner: Weak<Mutex<Inner>>,
    pages: Vec<Shown>,
    after: &'static str,
) {
    if pages.is_empty() {
        return;
    }
    let mut look = Look::new(inner, pages, after);
    post_delayed_task(ThreadId::UI, Some(&mut look), LOOK);
}

// The window pages shown again, `LOOK` on.
wrap_task! {
    struct Look {
        inner: Weak<Mutex<Inner>>,
        pages: Vec<Shown>,
        after: &'static str,
    }

    impl Task {
        fn execute(&self) {
            let gone: Vec<(String, Browser)> = {
                let Some(inner) = self.inner.upgrade() else { return };
                let mut inner = inner.lock().unwrap_or_else(|e| e.into_inner());
                let stalled: Vec<&Shown> = (self.pages.iter())
                    .filter(|page| {
                        let shown_now = inner.records.get(&page.surface).is_some_and(|r| {
                            shown(r.state)
                                && r.browser.as_ref().map(|b| b.identifier()) == Some(page.browser)
                        });
                        let v = page.view.lock();
                        let now = (paints(&v), v.counts.begin_frames);
                        replace(shown_now, (page.paints, now.0), (page.fed, now.1))
                    })
                    .collect();
                (stalled.into_iter())
                    .filter_map(|page| {
                        let browser = forget(&mut inner, &page.surface, page.browser)?;
                        Some((page.surface.clone(), browser))
                    })
                    .collect()
            };
            for (surface, browser) in gone {
                let why = format!("painted nothing again once {} showed it", self.after);
                close_replaced(&surface, &browser, &why);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Room, replace, shown};
    use crate::web_host::lifecycle::State;

    #[test]
    fn only_a_shown_surface_with_its_renderer_holds_a_frame_to_hand_over() {
        assert!(shown(State::Live { hidden: false }));
        assert!(!shown(State::Live { hidden: true }));
        assert!(!shown(State::Asleep { hidden: false }));
        assert!(!shown(State::Dead { hidden: false }));
        assert!(!shown(State::Gone));
    }

    #[test]
    fn a_room_without_its_host_makes_none() {
        Room::none().make(7);
    }

    #[test]
    fn a_page_shown_again_is_replaced_only_when_it_took_frames_and_painted_none() {
        assert!(
            replace(true, (4, 4), (10, 13)),
            "frames came, nothing painted"
        );
        assert!(!replace(true, (4, 5), (10, 13)), "it painted");
        assert!(!replace(false, (4, 4), (10, 13)), "hidden again meanwhile");
        assert!(
            !replace(true, (4, 4), (10, 10)),
            "no frames: the desk out of sight or asleep"
        );
    }
}
