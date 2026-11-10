//! A placeholder's card: what a window shows while its plugin has no live frame, or over its last
//! frame while it does not answer (ADR 0134, #39, #44): its title, a line and its actions.

use super::{Chrome, Role};
use crate::node::NodeId;
use crate::scene::{Scene, SceneError};
use crate::types::Rect;

/// How tall a placeholder's action is, and the room round its label.
pub(super) const ACTION_H: f32 = 32.0;
const ACTION_PAD: f32 = 12.0;
/// A label's width per character, for laying actions out before the text is set.
const ACTION_CHAR: f32 = 7.5;

impl Chrome {
    /// What a window shows in its content box `rect` while its plugin has no live frame (`over`
    /// false: the placeholder's fill), or over its last frame while it does not answer (`over`:
    /// a scrim): its title, a line under it and its actions, centred. Answers every part made.
    #[allow(clippy::too_many_arguments)]
    pub fn card(
        &mut self,
        scene: &mut Scene,
        parent: NodeId,
        rect: Rect,
        title: &str,
        line: &str,
        actions: &[&str],
        over: bool,
    ) -> Result<Vec<NodeId>, SceneError> {
        let mut made = Vec::new();
        let fill = if over { Role::Scrim } else { Role::Placeholder };
        made.push(self.add(scene, parent, fill, rect, "")?);
        let pad = self.theme.window.padding;
        let middle = rect.y + rect.height / 2.0;
        let width = (rect.width - 2.0 * pad).clamp(0.0, 420.0);
        let left = rect.x + (rect.width - width) / 2.0;
        let title_box = Rect::new(rect.x, middle - 40.0, rect.width, 22.0);
        made.push(self.add(scene, parent, Role::PlaceholderLabel, title_box, title)?);
        if !line.is_empty() {
            let line_box = Rect::new(left, middle - 14.0, width, 36.0);
            made.push(self.add(scene, parent, Role::PlaceholderLine, line_box, line)?);
        }
        let widths: Vec<f32> = (actions.iter())
            .map(|a| 2.0 * ACTION_PAD + ACTION_CHAR * a.chars().count() as f32)
            .collect();
        let gap = 8.0;
        let row = widths.iter().sum::<f32>() + gap * widths.len().saturating_sub(1) as f32;
        let mut x = rect.x + (rect.width - row) / 2.0;
        for (label, w) in actions.iter().zip(widths) {
            let button = Rect::new(x, middle + 30.0, w, ACTION_H);
            made.push(self.add(scene, parent, Role::Action, button, "")?);
            made.push(self.add(scene, parent, Role::ActionLabel, button, label)?);
            x += w + gap;
        }
        Ok(made)
    }
}
