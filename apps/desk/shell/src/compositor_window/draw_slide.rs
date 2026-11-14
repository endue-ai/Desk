//! The desktop that left, on its way out (ADR 0222): its windows as they were last drawn
//! (`hosted_slide.rs`), in one sheet moved to the side, under the windows of the desktop coming
//! in. The sheet takes no pointer and none of its surfaces is placed: a press during the slide is
//! for the desktop in front, and the pages of the desktop that left are no longer shown.

use desk_compositor::{Chrome, GroupNode, Node, NodeId, Scene, SceneError};

use super::draw::{Drawn, Sources, window};
use super::hosted::Hosted;

/// Draw the desktop that left in `desk`, if a switch slides.
pub(super) fn leaving(
    scene: &mut Scene,
    chrome: &mut Chrome,
    desk: NodeId,
    hosted: &Hosted,
    from: &Sources,
) -> Result<(), SceneError> {
    let Some((windows, out)) = hosted.leaving() else {
        return Ok(());
    };
    let moved = GroupNode::translated(out as f32, 0.0);
    let sheet = scene.insert(desk, Node::from(moved).with_hit(false))?;
    // What a window's drawing tells the input router and the web host goes nowhere.
    let mut unheard = Drawn::default();
    for w in windows {
        window(scene, chrome, sheet, w, hosted, from, &mut unheard)?;
    }
    Ok(())
}
