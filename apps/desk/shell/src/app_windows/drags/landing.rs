//! Commit a drop to the app window's page once its receiving target accepts it.

use desk_compositor::input::dnd::type_of;
use desk_surface::generated::{SurfaceDragItem, SurfaceDropAnswer};
use serde_json::json;

use super::{Act, Drags, Source};

impl Drags {
    /// The drag lands: on the page's target with its effect, else (from the OS) its files open.
    pub(super) fn land(&mut self) -> Vec<Act> {
        let types = self
            .drag
            .as_ref()
            .map(|d| self.types(d))
            .unwrap_or_default();
        let Some(drag) = self.drag.as_mut() else {
            return Vec::new();
        };
        if drag.entered && drag.answer != SurfaceDropAnswer::None {
            drag.dropped = true;
            let items: Vec<&SurfaceDragItem> = (drag.items.iter())
                .filter(|item| types.contains(&type_of(item)))
                .collect();
            let (x, y) = drag.at;
            let drop = json!({ "type": "desk:drop", "drag": drag.id, "x": x, "y": y,
                "keys": drag.keys, "effect": drag.answer, "items": items });
            // A drop from the OS ends here; the page's own drag ends with the effect performed.
            let grant = matches!(drag.source, Source::Os(_)).then(|| {
                let paths = items
                    .into_iter()
                    .filter_map(|item| match item {
                        SurfaceDragItem::SurfaceDragPaths(paths) => Some(&paths.paths),
                        _ => None,
                    })
                    .flatten()
                    .map(|path| path.path.clone())
                    .collect();
                let destination = if drag.answer == SurfaceDropAnswer::Link {
                    None
                } else {
                    drag.destination.clone()
                };
                Act::GrantFiles {
                    target: self.owner.clone(),
                    paths,
                    destination,
                }
            });
            if grant.is_some() {
                self.drag = None;
            }
            return grant.into_iter().chain([Act::Page(drop)]).collect();
        }
        let source = drag.source.clone();
        let mut out = self.leave();
        match source {
            Source::Os(paths) => out.push(Act::Open(paths)),
            Source::Page(local) => out.push(Self::ended(local, SurfaceDropAnswer::None, None)),
        }
        out
    }
}
