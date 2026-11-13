//! Laying the compositor window's scene out again (#81, #54): from the hosted desk, the frames the
//! surfaces attached, the spread while it is open and the canvas map with its thumbnails (refreshed
//! here, under the compositor's lock, at most ten times a second); then what the scene drew goes to
//! the input router, the window manager's cards, the spread, the map and accessibility, and where
//! it drew each plugin surface to the web host, the screen its popups are placed in (#156). A frame
//! for which only surfaces' pictures changed (a caret's blink, a page's own animation) draws the
//! scene as it was laid out: laying it out took 30 to 40 ms of the debug build's main thread a
//! frame, most of what a blinking caret cost a desk at rest (R1).

use std::time::Instant;

use super::{CompositorWindow, PAGE, draw, draw_map};
use crate::web_host::render::popup_screen::App;

impl CompositorWindow {
    /// The scene the next frame draws: laid out again when the desk changed (`Composed::dirty`),
    /// as it was when only surfaces' pictures did (`Composed::repainted`).
    pub(super) fn scene_for_frame(&mut self) {
        if self.shared.lock().dirty {
            self.compose();
        } else {
            self.repaint();
        }
    }

    /// Only surfaces' pictures changed: the scene stays, and the canvas map's thumbnails of those
    /// surfaces are drawn again from the new pictures, at most ten times a second. A thumbnail the
    /// map had not made yet lays the scene out at the next frame.
    fn repaint(&mut self) {
        let scale = self.window.scale_factor() as f32;
        // The map shows its windows (unfolded) where it drew its view.
        let open = (self.mapping.drawn.as_ref()).is_some_and(|map| map.view.is_some());
        let layout = self.mapping.layout.take();
        if let Some(layout) = layout.as_ref().filter(|_| open) {
            let mut composed = self.shared.lock();
            let changed = composed.repainted.clone();
            let made = (self.mapping).refresh(
                &mut composed,
                layout,
                scale,
                Instant::now(),
                Some(&changed),
            );
            composed.dirty |= made;
        }
        self.mapping.layout = layout;
        if !self.gpu.presents() {
            self.shared.lock().repainted.clear();
        }
    }

    /// Lay the scene out again from the hosted desk and the frames the surfaces attached, and tell
    /// the input router what each node shows.
    pub(super) fn compose(&mut self) {
        let scale = self.window.scale_factor() as f32;
        let folded = self.map_folded();
        let held = self.mapping.held();
        let layout = folded.and_then(|_| draw_map::layout(&self.hosted, held));
        let at = self.hosted.ms(Instant::now());
        let drawn = {
            let mut composed = self.shared.lock();
            match (&layout, folded) {
                (Some(layout), Some(false)) => {
                    self.mapping
                        .refresh(&mut composed, layout, scale, Instant::now(), None);
                }
                // Folded or gone, the map keeps no copies.
                _ => self
                    .mapping
                    .thumbnails
                    .retain(&mut composed.compositor, |_| false),
            }
            let texture = |surface: &str| {
                let id = composed.texture_of(surface)?;
                Some((id, composed.frames.size(id)?))
            };
            let popup = |surface: &str| {
                let (place, id, size) = composed.popup_of(surface)?;
                let at = desk_compositor::Rect::new(place.x, place.y, place.width, place.height);
                Some((at, (id, size)))
            };
            let thumbnails = &self.mapping.thumbnails;
            let thumbnail = |host: &str| thumbnails.of(composed.texture_of(host)?);
            let map = (layout.as_ref()).map(|layout| draw_map::MapSource {
                layout,
                folded: folded.unwrap_or(true),
                thumbnail: &thumbnail,
            });
            let sources = draw::Sources {
                scale,
                page: texture(PAGE),
                surface: &texture,
                popup: &popup,
                spread: self.spreading.open.as_ref().map(|s| (s, at)),
                map,
            };
            draw::draw(&mut self.scene, &self.theme, &self.hosted, &sources)
        };
        let drawn = drawn.unwrap_or_else(|why| {
            eprintln!("endue Desk: the compositor's scene did not build ({why:?})");
            draw::Drawn::default()
        });
        if !self.gpu.presents() {
            self.shared.lock().drawn();
        }
        self.a11y_drawn(&drawn);
        self.gestures.buttons = drawn.buttons;
        self.parts = (drawn.parts, drawn.order);
        self.spreading.cards = drawn.cards;
        self.spreading.bar = drawn.bar;
        self.mapping.drawn = drawn.map;
        self.mapping.layout = layout;
        self.gestures.popups.boxes = drawn.popups;
        crate::frame_trace::laid_out(self.hosted.plan(), &drawn.placed);
        if let Some(plan) = self.hosted.plan() {
            let placed: Vec<(String, (f32, f32))> = (drawn.placed.into_iter())
                .map(|(host, at)| (host, (at.x, at.y)))
                .collect();
            let free = plan.bars.free;
            let app = App::new(
                (plan.screen.w, plan.screen.h),
                [free.x, free.y, free.w, free.h],
            );
            self.host.placed(&placed, app, Instant::now());
        }
        self.register(drawn.shown, &drawn.pages);
        self.tip_draw();
        // A window's page opened since the last look is laid out and given its focus (ADR 0201).
        self.place_window_pages();
    }
}
