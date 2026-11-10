//! Laying the compositor window's scene out again (#81, #54): from the hosted desk, the frames the
//! surfaces attached, the spread while it is open and the canvas map with its thumbnails (refreshed
//! here, under the compositor's lock, at most ten times a second); then what the scene drew goes to
//! the input router, the window manager's cards, the spread, the map and accessibility.

use std::time::Instant;

use super::{CompositorWindow, PAGE, draw, draw_map};

impl CompositorWindow {
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
            if let (Some(layout), Some(false)) = (&layout, folded) {
                self.mapping
                    .refresh(&mut composed, layout, scale, Instant::now());
            }
            let texture = |surface: &str| {
                let id = composed.texture_of(surface)?;
                Some((id, composed.frames.size(id)?))
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
            self.shared.lock().dirty = false;
        }
        self.a11y_drawn(&drawn);
        self.gestures.buttons = drawn.buttons;
        self.parts = (drawn.parts, drawn.order);
        self.spreading.cards = drawn.cards;
        self.spreading.bar = drawn.bar;
        self.mapping.drawn = drawn.map;
        self.mapping.layout = layout;
        self.register(drawn.shown);
    }
}
