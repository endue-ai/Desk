//! What a plugin pane shows (#81, #54): its surface's frame, and its open popup over it (#156); a
//! card over its last frame while it does not answer (Wait, Stop); its last frame greyed under a
//! card with Reload while it sleeps (ADR 0134: the compositor keeps a surface's last texture when
//! its process goes); a card instead of a frame while it has none (stopped, crashed, not painted
//! yet). A card lets the pointer through to the page, but for its buttons, each of which runs its
//! desk command for the plugin.

use desk_compositor::glam::Vec2;
use desk_compositor::{Chrome, NodeId, Rect, Scene, SceneError, SurfaceNode};
use desk_wm::FrameState;

use super::draw::{CardButton, Drawn, Sources, pass, sampled, target};
use super::hosted::Hosted;
use super::report::Card;

/// Where a plugin's surface goes: a group, the box in it, and the title a card names.
pub struct Into<'a> {
    pub group: NodeId,
    pub to: Rect,
    pub title: &'a str,
}

/// The commands a card's buttons run, in the order the page lists them: Not responding's Wait and
/// Stop, a stopped or sleeping frame's Reload.
fn commands(state: FrameState) -> &'static [&'static str] {
    match state {
        FrameState::Late => &["desk.frames.wait", "desk.frames.stop"],
        FrameState::Stopped | FrameState::Asleep => &["desk.frames.reload"],
        _ => &[],
    }
}

/// How a card lies on the pane.
#[derive(Clone, Copy, PartialEq)]
enum On {
    /// Instead of a frame.
    Nothing,
    /// Over the last frame of a surface that does not answer.
    Late,
    /// Over the greyed last frame of a surface that sleeps.
    Sleeping,
}

/// What plugin `plugin`'s pane shows.
pub fn surface(
    scene: &mut Scene,
    chrome: &mut Chrome,
    into: &Into,
    plugin: &str,
    hosted: &Hosted,
    from: &Sources,
    drawn: &mut Drawn,
) -> Result<(), SceneError> {
    let frame = hosted.frame(plugin);
    let copy = hosted.report().map(|r| r.copy.clone()).unwrap_or_default();
    let state = frame.map_or(FrameState::Live, |f| f.state);
    let host = frame.map(|f| f.host.as_str()).unwrap_or_default();
    let card = |fallback: &str| {
        let given = frame.and_then(|f| f.card.clone());
        given.unwrap_or_else(|| Card {
            title: into.title.to_owned(),
            line: fallback.to_owned(),
            actions: Vec::new(),
        })
    };
    let mut shows = |c: &Card, chrome: &mut Chrome, scene: &mut Scene, on: On| {
        let actions: Vec<&str> = c.actions.iter().map(String::as_str).collect();
        let (group, to) = (into.group, into.to);
        let made = match on {
            On::Sleeping => chrome.sleeping_card(scene, group, to, &c.title, &c.line, &actions),
            _ => chrome.card(
                scene,
                group,
                to,
                &c.title,
                &c.line,
                &actions,
                on == On::Late,
            ),
        }?;
        let first = made.len().saturating_sub(2 * actions.len());
        let runs = commands(state);
        let mut through = made[..first].to_vec();
        for (i, pair) in made[first..].chunks(2).enumerate() {
            match runs.get(i) {
                Some(command) => drawn.buttons.push(CardButton {
                    node: pair[0],
                    command,
                    plugin: plugin.to_owned(),
                }),
                None => through.push(pair[0]),
            }
            through.extend(pair.get(1));
        }
        pass(scene, through)
    };
    let texture = (from.surface)(host);
    if state.away() {
        // Asleep with a frame kept: that frame, greyed, under the card.
        if let (FrameState::Asleep, Some(texture)) = (state, texture) {
            let last = SurfaceNode {
                grey: 1.0,
                ..sampled(into.to, texture, from.scale)
            };
            let node = scene.insert(into.group, last)?;
            pass(scene, [node])?;
            return shows(&card(""), chrome, scene, On::Sleeping);
        }
        return shows(&card(""), chrome, scene, On::Nothing);
    }
    if hosted.surfaces().dead(host) {
        return shows(&card(&copy.crashed), chrome, scene, On::Nothing);
    }
    let Some(texture) = texture else {
        return shows(&card(&copy.loading), chrome, scene, On::Nothing);
    };
    let node = scene.insert(into.group, sampled(into.to, texture, from.scale))?;
    drawn.shown.push((node, target(host, Vec2::ZERO)));
    super::draw_popup::over(scene, into.group, into.to, host, from, &mut drawn.shown)?;
    if state == FrameState::Late {
        shows(&card(""), chrome, scene, On::Late)?;
    }
    Ok(())
}
