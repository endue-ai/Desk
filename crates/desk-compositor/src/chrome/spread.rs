//! The spread's chrome (ADR 0116, the runtime's `arrange/spread-view.ts` and `arrange.css` at
//! 789c349b): the scrim over the desk, the filter field at the top with what is typed (or its
//! placeholder), the bar under it with the count and the hint, the message in the middle when
//! nothing matches, and the ring round the selected card. Laid out as the stylesheet did: the bar
//! 32 px from the top, at most 440 px wide and 24 px clear of each side.

use super::{Chrome, Role};
use crate::node::{NodeId, RectNode};
use crate::scene::{Scene, SceneError};
use crate::text::{TextAlign, TextNode, TextStyle};
use crate::types::{Rect, Stroke};

const TOP: f32 = 32.0;
const SIDE: f32 = 24.0;
const WIDTH: f32 = 440.0;
const GAP: f32 = 8.0;
/// The bar's padding (`--space-1` by `--space-3`) round one line of `--text-xs`.
const META_H: f32 = 26.0;
/// The ring's distance outside the card (`outline-offset: 3px`).
const RING_OFFSET: f32 = 3.0;

/// A part of the spread's chrome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpreadPart {
    Scrim,
    Field,
    /// What is typed, or the placeholder while nothing is.
    FieldText {
        typed: bool,
    },
    Meta,
    Count,
    Hint,
    Empty,
    EmptyText,
    Ring,
}

/// What the spread's chrome says, in the desk's language.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SpreadText<'a> {
    pub filter: &'a str,
    pub placeholder: &'a str,
    pub count: &'a str,
    pub hint: &'a str,
    /// The message while nothing matches.
    pub empty: Option<&'a str>,
}

/// The nodes of the spread's chrome.
#[derive(Clone, Debug, PartialEq)]
pub struct SpreadChrome {
    pub field: NodeId,
    pub text: NodeId,
    pub count: NodeId,
    pub hint: NodeId,
    pub empty: Option<NodeId>,
    /// Every node made, for the caller to let the pointer through.
    pub nodes: Vec<NodeId>,
}

impl Chrome {
    /// The scrim over everything under the spread, in `rect` (the app).
    pub fn spread_scrim(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
    ) -> Result<NodeId, SceneError> {
        self.add(scene, parent, Role::Spread(SpreadPart::Scrim), rect, "")
    }

    /// The field, the bar under it and the message when nothing matches, for an app `app`.
    pub fn spread_bar(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        app: Rect,
        text: &SpreadText,
    ) -> Result<SpreadChrome, SceneError> {
        let s = &self.theme.spread;
        let width = WIDTH.min(app.width - 2.0 * SIDE).max(0.0);
        let x = app.x + (app.width - width) / 2.0;
        let field = Rect::new(x, app.y + TOP, width, s.field_height);
        let meta = Rect::new(x, field.y + field.height + GAP, width, META_H);
        let part = |p| Role::Spread(p);
        let mut nodes = Vec::new();
        let field_node = self.add(scene, parent, part(SpreadPart::Field), field, "")?;
        let typed = !text.filter.is_empty();
        let shows = if typed { text.filter } else { text.placeholder };
        let text_role = part(SpreadPart::FieldText { typed });
        let text_node = self.add(scene, parent, text_role, field, shows)?;
        nodes.extend([field_node, text_node]);
        nodes.push(self.add(scene, parent, part(SpreadPart::Meta), meta, "")?);
        let count = self.add(scene, parent, part(SpreadPart::Count), meta, text.count)?;
        let hint = self.add(scene, parent, part(SpreadPart::Hint), meta, text.hint)?;
        nodes.extend([count, hint]);
        let mut empty = None;
        if let Some(message) = text.empty {
            let at = Rect::new(x, app.y + app.height * 0.45, width, 36.0);
            nodes.push(self.add(scene, parent, part(SpreadPart::Empty), at, "")?);
            let line = self.add(scene, parent, part(SpreadPart::EmptyText), at, message)?;
            nodes.push(line);
            empty = Some(line);
        }
        Ok(SpreadChrome {
            field: field_node,
            text: text_node,
            count,
            hint,
            empty,
            nodes,
        })
    }

    /// The ring round a selected card whose box is `rect`, in its group's units.
    pub fn spread_ring(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
    ) -> Result<NodeId, SceneError> {
        self.add(scene, parent, Role::Spread(SpreadPart::Ring), rect, "")
    }

    pub(super) fn spread_node(&self, part: SpreadPart, base: Rect, text: &str) -> crate::Node {
        let s = &self.theme.spread;
        let line = |style: &TextStyle, rect: Rect| TextNode::new(rect, text, style.clone());
        let inset =
            |r: Rect, by: f32| Rect::new(r.x + by, r.y, (r.width - 2.0 * by).max(0.0), r.height);
        match part {
            SpreadPart::Scrim => RectNode::new(base, s.scrim).into(),
            SpreadPart::Field => RectNode {
                stroke: Some(Stroke {
                    width: self.theme.window.border_width,
                    color: s.field_border,
                }),
                radius: s.field_radius,
                shadow: s.field_shadow,
                ..RectNode::new(base, s.field)
            }
            .into(),
            SpreadPart::FieldText { typed } => {
                let style = if typed { &s.text } else { &s.placeholder };
                line(style, inset(base, s.field_padding)).into()
            }
            SpreadPart::Meta | SpreadPart::Empty => RectNode {
                stroke: Some(Stroke {
                    width: self.theme.window.border_width,
                    color: s.meta_border,
                }),
                radius: s.meta_radius,
                ..RectNode::new(base, s.meta)
            }
            .into(),
            SpreadPart::Count => line(&s.count, inset(base, 12.0)).into(),
            SpreadPart::Hint => {
                let style = TextStyle {
                    align: TextAlign::End,
                    ..s.meta_text.clone()
                };
                line(&style, inset(base, 12.0)).into()
            }
            SpreadPart::EmptyText => {
                let style = TextStyle {
                    align: TextAlign::Center,
                    ..s.text.clone()
                };
                line(&style, inset(base, 16.0)).into()
            }
            SpreadPart::Ring => RectNode {
                stroke: Some(Stroke {
                    width: s.ring_width,
                    color: s.ring,
                }),
                radius: self.theme.window.radius + RING_OFFSET,
                ..RectNode::new(
                    base.inflate(RING_OFFSET + s.ring_width),
                    crate::Color::TRANSPARENT,
                )
            }
            .into(),
        }
    }
}
