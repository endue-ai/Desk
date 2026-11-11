//! The web host's input side (#56): the compositor's input and drag messages to a surface's browser
//! (`input.rs`, `drag.rs`), and what the browser says back about input: its cursor, its hover
//! title (an off-screen page draws none: CEF's `OnTooltip`, #156), whether it takes text, its
//! caret, its page's drag messages, and drags its page starts itself (CEF's `StartDragging`: a
//! link, a text selection or files, offered to the broker as desk data).

use cef::*;
use desk_surface::generated::{
    CompositorMessage, SurfaceDragItem, SurfaceDragPath, SurfaceDragPaths, SurfaceDragStart,
    SurfaceDragText, SurfaceDragUri, SurfaceDropEffect, SurfaceImeCaret, SurfaceImeEnabled,
    SurfaceMessage, SurfaceRect,
};

use super::drag::{self, Up};
use super::{WebHost, input};

fn rect(r: &Rect) -> SurfaceRect {
    SurfaceRect {
        x: f64::from(r.x),
        y: f64::from(r.y),
        width: f64::from(r.width),
        height: f64::from(r.height),
    }
}

/// `ime.caret` from CEF's composition bounds: the caret after the last composed character.
pub fn caret(surface: &str, bounds: &[Rect]) -> Option<SurfaceMessage> {
    let last = bounds.last()?;
    let caret = SurfaceRect {
        x: f64::from(last.x + last.width),
        y: f64::from(last.y),
        width: 1.0,
        height: f64::from(last.height.max(1)),
    };
    Some(SurfaceMessage::SurfaceImeCaret(SurfaceImeCaret {
        r#type: Default::default(),
        surface: surface.to_owned(),
        caret,
        characters: Some(bounds.iter().map(rect).collect()),
    }))
}

/// `ime.enabled` from the text input mode CEF asks a virtual keyboard for.
pub fn enabled(surface: &str, mode: TextInputMode) -> SurfaceMessage {
    SurfaceMessage::SurfaceImeEnabled(SurfaceImeEnabled {
        r#type: Default::default(),
        surface: surface.to_owned(),
        enabled: mode != TextInputMode::NONE,
    })
}

/// The desk data of a drag CEF started in a page, and the effects it allows.
pub fn started(
    surface: &str,
    data: &mut DragData,
    ops: DragOperationsMask,
) -> Option<SurfaceDragStart> {
    use cef::sys::cef_drag_operations_mask_t as O;
    let mut items = Vec::new();
    if data.is_link() == 1 {
        let uri = CefString::from(&data.link_url()).to_string();
        let title = CefString::from(&data.link_title()).to_string();
        let title = (!title.is_empty()).then_some(title);
        items.push(SurfaceDragItem::SurfaceDragUri(SurfaceDragUri {
            r#type: Default::default(),
            uri,
            title,
        }));
    }
    if data.is_fragment() == 1 {
        let text = CefString::from(&data.fragment_text()).to_string();
        if !text.is_empty() {
            items.push(SurfaceDragItem::SurfaceDragText(SurfaceDragText {
                r#type: Default::default(),
                text,
            }));
        }
    }
    if data.is_file() == 1 {
        let mut names = CefStringList::new();
        data.file_names(Some(&mut names));
        let paths: Vec<SurfaceDragPath> = crate::drops::local_paths(names)
            .into_iter()
            .map(|path| SurfaceDragPath { path, kind: None })
            .collect();
        if !paths.is_empty() {
            items.push(SurfaceDragItem::SurfaceDragPaths(SurfaceDragPaths {
                r#type: Default::default(),
                paths,
            }));
        }
    }
    let ops: O = ops.into();
    let effect_allowed: Vec<SurfaceDropEffect> = [
        (O::DRAG_OPERATION_COPY, SurfaceDropEffect::Copy),
        (O::DRAG_OPERATION_MOVE, SurfaceDropEffect::Move),
        (O::DRAG_OPERATION_LINK, SurfaceDropEffect::Link),
    ]
    .into_iter()
    .filter(|(op, _)| ops.0 & op.0 != 0)
    .map(|(_, effect)| effect)
    .collect();
    (!items.is_empty() && !effect_allowed.is_empty()).then(|| SurfaceDragStart {
        r#type: Default::default(),
        surface: surface.to_owned(),
        items,
        effect_allowed,
        image: None,
    })
}

impl WebHost {
    /// An input, drag or accessibility message for a surface; false when it is none of them.
    pub fn route(&self, surface: &str, message: &CompositorMessage) -> bool {
        let (is_input, is_drag) = (input::is_input(message), drag::is_drag(message));
        if !is_input && !is_drag {
            return self.a11y(surface, message);
        }
        let (browser, height, mut composing, down) = {
            let mut inner = self.inner();
            let Some(record) = inner.records.get_mut(surface) else {
                return true;
            };
            let down = is_drag.then(|| record.drag.down(message)).flatten();
            let ended_cef =
                matches!(message, CompositorMessage::SurfaceDragEnded(_)) && down.is_none();
            let height = f64::from(record.view.lock().size.1);
            let composing = record.composing.take();
            (
                record.browser.clone().map(|b| (b, ended_cef)),
                height,
                composing,
                down,
            )
        };
        let Some((browser, ended_cef)) = browser else {
            return true;
        };
        if is_input && let Some(host) = browser.host() {
            input::deliver(&host, message, &mut composing, height);
        }
        if let Some(text) = down
            && let Some(frame) = browser.main_frame()
        {
            crate::host::send(frame, text);
        }
        // A drag the page's engine started (a link, a selection) ended: CEF hears where and how.
        if ended_cef && let Some(host) = browser.host() {
            host.drag_source_ended_at(0, 0, DragOperationsMask::default());
            host.drag_source_system_drag_ended();
        }
        if let Some(record) = self.inner().records.get_mut(surface) {
            record.composing = composing;
        }
        true
    }

    /// The page of `surface` posted `text` to its parent: whether the broker took it (the runtime
    /// hears it otherwise).
    pub fn drag_up(&self, surface: &str, text: &str) -> bool {
        let up = {
            let mut inner = self.inner();
            let Some(record) = inner.records.get_mut(surface) else {
                return false;
            };
            record.drag.up(surface, text)
        };
        match up {
            Up::Pass => false,
            Up::Take(messages) => {
                messages.into_iter().for_each(|m| self.sink.message(m));
                true
            }
            Up::Both(messages) => {
                messages.into_iter().for_each(|m| self.sink.message(m));
                false
            }
            Up::Answer(text) => {
                if let Some(frame) = self.browser(surface).and_then(|b| b.main_frame()) {
                    crate::host::send(frame, text);
                }
                true
            }
        }
    }

    /// Surface `surface` wants CEF's cursor `kind`.
    pub fn cursor(&self, surface: &str, kind: CursorType, custom: Option<&CursorInfo>) {
        let change = super::cursor::change(surface, kind, custom);
        self.sink
            .message(SurfaceMessage::SurfaceCursorChange(change));
    }

    /// The page of `surface` shows `title` on hover now (`""`: none, the pointer left it): the
    /// compositor draws it once the pointer rests (`compositor_window/tooltip.rs`).
    pub fn tooltip(&self, surface: &str, title: &str) {
        self.sink.tooltip(surface, title);
    }
}
