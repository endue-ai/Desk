//! The desk's own chrome as scene nodes: window frames with title bars, edge bars, snap previews,
//! toasts, placeholders, the spread's and the canvas map's (#54), styled by a [`ChromeTheme`]. [`Chrome`] remembers every part it made,
//! so [`Chrome::set_theme`] restyles them all in one pass and the next frame shows the new look
//! whole. Geometry stays the window manager's: it moves groups; the parts keep their boxes.

use crate::node::{GroupNode, Node, NodeId, RectNode};
use crate::scene::{Scene, SceneError, Wallpaper};
use crate::text::TextNode;
use crate::theme::ChromeTheme;
use crate::types::{Rect, Stroke};
use std::sync::Arc;

/// What a part is, which decides the tokens it takes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    WindowFrame {
        focused: bool,
    },
    TitleDivider,
    Title {
        subtitled: bool,
    },
    Subtitle,
    Bar,
    BarLabel,
    SnapPreview,
    Toast,
    ToastText,
    Placeholder,
    PlaceholderLabel,
    /// A placeholder's line under its title, wrapped.
    PlaceholderLine,
    /// Over a window's last frame while it does not answer; lighter over a sleeping one's.
    Scrim,
    Veil,
    /// A button a placeholder offers (Reload, Wait, Stop) and its label.
    Action,
    ActionLabel,
    /// The spread's chrome (ADR 0116) and the canvas map's (ADR 0082), #54.
    Spread(SpreadPart),
    Map(MapPart),
}

mod card;
mod map;
mod spread;

pub use map::{MapChrome, MapPart};
pub use spread::{SpreadChrome, SpreadPart, SpreadText};

use card::ACTION_H;

/// A part: its node, its role, the box it was made for (a window's own outer box, in its group's
/// units, for every part of a window) and its text.
#[derive(Clone, Debug)]
struct Part {
    node: NodeId,
    role: Role,
    base: Rect,
    text: Arc<str>,
}

/// A window's chrome: the group the window manager moves, the parts in it, and where its content
/// goes (in the group's units).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WindowChrome {
    pub group: NodeId,
    pub frame: NodeId,
    pub divider: NodeId,
    pub title: NodeId,
    pub subtitle: Option<NodeId>,
    pub content: Rect,
}

/// The chrome parts of one scene and the look they have.
#[derive(Debug)]
pub struct Chrome {
    theme: ChromeTheme,
    parts: Vec<Part>,
}

impl Chrome {
    pub fn new(theme: ChromeTheme) -> Chrome {
        Chrome {
            theme,
            parts: Vec::new(),
        }
    }

    pub fn theme(&self) -> &ChromeTheme {
        &self.theme
    }

    /// A window whose frame is `rect` (in `parent`'s units): a group at its corner holding the
    /// frame, the title bar's divider, the title and an optional subtitle.
    pub fn window(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        title: &str,
        subtitle: Option<&str>,
        focused: bool,
    ) -> Result<WindowChrome, SceneError> {
        let group = scene.insert(parent, GroupNode::translated(rect.x, rect.y))?;
        let base = Rect::new(0.0, 0.0, rect.width, rect.height);
        let frame = self.add(scene, group, Role::WindowFrame { focused }, base, "")?;
        let divider = self.add(scene, group, Role::TitleDivider, base, "")?;
        let role = Role::Title {
            subtitled: subtitle.is_some(),
        };
        let title = self.add(scene, group, role, base, title)?;
        let subtitle = match subtitle {
            Some(text) => Some(self.add(scene, group, Role::Subtitle, base, text)?),
            None => None,
        };
        let w = &self.theme.window;
        let content = Rect::new(
            w.border_width,
            w.title_height,
            (rect.width - 2.0 * w.border_width).max(0.0),
            (rect.height - w.title_height - w.border_width).max(0.0),
        );
        Ok(WindowChrome {
            group,
            frame,
            divider,
            title,
            subtitle,
            content,
        })
    }

    /// An edge bar in `rect`, with a label when given.
    pub fn bar(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        label: Option<&str>,
    ) -> Result<(NodeId, Option<NodeId>), SceneError> {
        let bar = self.add(scene, parent, Role::Bar, rect, "")?;
        let label = match label {
            Some(text) => Some(self.add(scene, parent, Role::BarLabel, rect, text)?),
            None => None,
        };
        Ok((bar, label))
    }

    /// Where a dragged window will snap.
    pub fn snap_preview(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
    ) -> Result<NodeId, SceneError> {
        self.add(scene, parent, Role::SnapPreview, rect, "")
    }

    /// A toast in `rect` with its message, wrapped.
    pub fn toast(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        message: &str,
    ) -> Result<(NodeId, NodeId), SceneError> {
        let toast = self.add(scene, parent, Role::Toast, rect, "")?;
        let text = self.add(scene, parent, Role::ToastText, rect, message)?;
        Ok((toast, text))
    }

    /// What a window shows in `rect` while it has no live content, with a label in its middle.
    pub fn placeholder(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        label: &str,
    ) -> Result<(NodeId, NodeId), SceneError> {
        let fill = self.add(scene, parent, Role::Placeholder, rect, "")?;
        let text = self.add(scene, parent, Role::PlaceholderLabel, rect, label)?;
        Ok((fill, text))
    }

    /// Keep a window's title clear of what floats over its title bar: at least `start` px from its
    /// left edge and `end` from its right (a filled window under the top chips, ADR 0132).
    pub fn clear_title(
        &mut self,
        scene: &mut Scene,
        window: &WindowChrome,
        start: f32,
        end: f32,
    ) -> Result<(), SceneError> {
        let pad = self.theme.window.padding;
        let whole = self.part_mut(window.frame)?.base;
        let left = (start - pad).max(0.0);
        let right = (end - pad).max(0.0);
        let base = Rect::new(
            whole.x + left,
            whole.y,
            (whole.width - left - right).max(0.0),
            whole.height,
        );
        for node in std::iter::once(window.title).chain(window.subtitle) {
            let part = self.part_mut(node)?;
            part.base = base;
            let part = part.clone();
            self.restyle(scene, &part)?;
        }
        Ok(())
    }

    /// Change a part's text (a title, a message, a label).
    pub fn set_text(
        &mut self,
        scene: &mut Scene,
        node: NodeId,
        text: &str,
    ) -> Result<(), SceneError> {
        let part = self.part_mut(node)?;
        part.text = Arc::from(text);
        let part = part.clone();
        self.restyle(scene, &part)
    }

    /// Show a window frame focused or not.
    pub fn set_focused(
        &mut self,
        scene: &mut Scene,
        frame: NodeId,
        focused: bool,
    ) -> Result<(), SceneError> {
        let part = self.part_mut(frame)?;
        part.role = Role::WindowFrame { focused };
        let part = part.clone();
        self.restyle(scene, &part)
    }

    /// Give every part the look of `theme`, and the wallpaper its colour, in one pass: the next
    /// frame draws the new look whole. Parts whose nodes are gone are forgotten.
    pub fn set_theme(&mut self, scene: &mut Scene, theme: ChromeTheme) {
        self.theme = theme;
        scene.set_wallpaper(Wallpaper::Solid(self.theme.wallpaper));
        self.parts.retain(|part| scene.node(part.node).is_some());
        for part in self.parts.clone() {
            let _ = self.restyle(scene, &part);
        }
    }

    fn add(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        role: Role,
        base: Rect,
        text: &str,
    ) -> Result<NodeId, SceneError> {
        let text: Arc<str> = Arc::from(text);
        let node = scene.insert(parent, self.node(role, base, &text))?;
        self.parts.push(Part {
            node,
            role,
            base,
            text,
        });
        Ok(node)
    }

    fn part_mut(&mut self, node: NodeId) -> Result<&mut Part, SceneError> {
        let part = self.parts.iter_mut().find(|p| p.node == node);
        part.ok_or(SceneError::NoSuchNode(node))
    }

    fn restyle(&self, scene: &mut Scene, part: &Part) -> Result<(), SceneError> {
        let hit = scene
            .node(part.node)
            .ok_or(SceneError::NoSuchNode(part.node))?
            .hit;
        let node = self.node(part.role, part.base, &part.text).with_hit(hit);
        scene.set(part.node, node)
    }

    /// The node a part is under the current look.
    fn node(&self, role: Role, base: Rect, text: &str) -> Node {
        let t = &self.theme;
        let w = &t.window;
        let line = |text_style: &crate::TextStyle, rect: Rect| {
            TextNode::new(rect, text, text_style.clone())
        };
        match role {
            Role::WindowFrame { focused } => RectNode {
                stroke: Some(Stroke {
                    width: w.border_width,
                    color: if focused { w.border_focused } else { w.border },
                }),
                radius: w.radius,
                shadow: w.shadow,
                ..RectNode::new(base, w.fill)
            }
            .into(),
            Role::TitleDivider => {
                let y = base.y + w.title_height - 1.0;
                let rect = Rect::new(
                    base.x + w.border_width,
                    y,
                    base.width - 2.0 * w.border_width,
                    1.0,
                );
                RectNode::new(rect, w.divider).into()
            }
            Role::Title { subtitled } => {
                let room = base.width - 2.0 * w.padding;
                let width = if subtitled { room * 0.6 } else { room };
                line(
                    &w.title,
                    Rect::new(base.x + w.padding, base.y, width.max(0.0), w.title_height),
                )
                .into()
            }
            Role::Subtitle => {
                let room = base.width - 2.0 * w.padding;
                let x = base.x + w.padding + room * 0.6 + 8.0;
                let rect = Rect::new(x, base.y, (room * 0.4 - 8.0).max(0.0), w.title_height);
                line(&w.subtitle, rect).into()
            }
            Role::Bar => RectNode {
                stroke: Some(Stroke {
                    width: w.border_width,
                    color: t.bar.border,
                }),
                radius: t.bar.radius,
                ..RectNode::new(base, t.bar.fill)
            }
            .into(),
            Role::BarLabel => line(&t.bar.text, inset(base, w.padding)).into(),
            Role::SnapPreview => RectNode {
                stroke: Some(Stroke {
                    width: t.snap.stroke_width,
                    color: t.snap.stroke,
                }),
                radius: t.snap.radius,
                ..RectNode::new(base, t.snap.fill)
            }
            .into(),
            Role::Toast => RectNode {
                stroke: Some(Stroke {
                    width: w.border_width,
                    color: t.toast.border,
                }),
                radius: t.toast.radius,
                shadow: t.toast.shadow,
                ..RectNode::new(base, t.toast.fill)
            }
            .into(),
            Role::ToastText => line(&t.toast.text, base.inflate(-t.toast.padding))
                .wrapped()
                .into(),
            Role::Placeholder => RectNode::new(base, t.placeholder.fill).into(),
            Role::PlaceholderLabel => line(&t.placeholder.text, inset(base, w.padding)).into(),
            Role::PlaceholderLine => line(&t.placeholder.line, base).wrapped().into(),
            Role::Scrim => RectNode::new(base, t.placeholder.scrim).into(),
            Role::Veil => RectNode::new(base, t.placeholder.veil).into(),
            Role::Action => RectNode {
                stroke: Some(Stroke {
                    width: w.border_width,
                    color: t.bar.border,
                }),
                radius: ACTION_H / 4.0,
                ..RectNode::new(base, t.bar.fill)
            }
            .into(),
            Role::ActionLabel => line(
                &crate::TextStyle {
                    align: crate::TextAlign::Center,
                    ..w.title.clone()
                },
                base,
            )
            .into(),
            Role::Spread(part) => self.spread_node(part, base, text),
            Role::Map(part) => self.map_node(part, base),
        }
    }
}

/// `rect` without `padding` at its left and right: a one-line label's box, centred down it.
fn inset(rect: Rect, padding: f32) -> Rect {
    let width = (rect.width - 2.0 * padding).max(0.0);
    Rect::new(rect.x + padding, rect.y, width, rect.height)
}

#[cfg(test)]
#[path = "chrome_tests.rs"]
mod tests;
