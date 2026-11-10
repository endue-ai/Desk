//! The plugin's loop on macOS: the desk's messages in, frames out. Each frame is drawn into an
//! IOSurface of the plugin's own; the first frame of each texture sends the IOSurface's Mach right
//! with it (`portIndex` 0), and the desk copies the frame (`after-copy`) and releases it at once.
//! Its two parts take Tab and hand the focus back past either end (`parts.rs`, #128).

use std::io;
use std::time::Instant;

use desk_surface::generated::SurfaceAttach;
use desk_surface::native::iosurface::{FORMAT, SharedTexture};
use desk_surface::native::plugin::{Heard, Plugin};
use desk_surface::{CompositorMessage, SurfaceMessage};
use serde_json::{Value, json};

use crate::parts::{Act, Controls};
use crate::scene::{Gpu, Look};
use crate::shown::Shown;

/// The surface and what draws it.
struct Drawing {
    shown: Shown,
    /// The texture of the current generation, and whether its right went to the desk.
    texture: Option<(SharedTexture, bool)>,
    hue: f32,
    last: Instant,
    controls: Controls,
}

pub fn run() -> io::Result<()> {
    let mut plugin = Plugin::connect()?;
    let speed = speed(&plugin);
    let gpu = Gpu::new(FORMAT)?;
    let mut drawing: Option<Drawing> = None;
    loop {
        let now = Instant::now();
        let wait = drawing.as_ref().and_then(|d| d.shown.wait(now));
        match plugin.next(wait)? {
            Heard::Closed => return Ok(()),
            Heard::Idle => {}
            Heard::Message(message) => {
                if !heard(&plugin, &mut drawing, *message)? {
                    return Ok(());
                }
            }
        }
        if let Some(d) = drawing.as_mut()
            && d.shown.due(Instant::now())
        {
            draw(&plugin, &gpu, d, speed)?;
        }
    }
}

/// The plugin's own setting `speed` (turns per ten seconds): its one bridge call. No permission is
/// needed for a plugin's own settings.
fn speed(plugin: &Plugin) -> f32 {
    let answer = plugin
        .bridge()
        .map(|b| b.call("settings.get", json!({ "key": "speed" })));
    match answer {
        Some(Ok(Ok(result))) => result["value"].as_f64().unwrap_or(1.0) as f32,
        Some(Ok(Err(error))) => {
            eprintln!("plugin-native-wgpu: settings.get was refused: {error}");
            1.0
        }
        _ => 1.0,
    }
}

/// Act on one message; `false` when the plugin should exit.
fn heard(
    plugin: &Plugin,
    drawing: &mut Option<Drawing>,
    message: CompositorMessage,
) -> io::Result<bool> {
    let now = Instant::now();
    match message {
        CompositorMessage::SurfaceCreate(m) => {
            let size = (m.size.width as u32, m.size.height as u32);
            start(
                plugin,
                drawing,
                Shown::new(m.surface, size, m.scale, m.hidden == Some(true), now),
            )?;
        }
        // A wake starts a new process: it is this one's create.
        CompositorMessage::SurfaceWake(m) => {
            let size = (m.size.width as u32, m.size.height as u32);
            match drawing.as_mut() {
                Some(d) => {
                    d.shown.resize(size, m.scale);
                }
                None => start(
                    plugin,
                    drawing,
                    Shown::new(m.surface, size, m.scale, false, now),
                )?,
            }
        }
        CompositorMessage::SurfaceResize(m) => {
            if let Some(d) = drawing.as_mut() {
                d.shown
                    .resize((m.size.width as u32, m.size.height as u32), m.scale);
                // The parts moved with the bottom edge.
                tell(plugin, d)?;
            }
        }
        CompositorMessage::SurfaceShow(_) => set(drawing, |s| s.hidden = false),
        CompositorMessage::SurfaceHide(_) => set(drawing, |s| s.hidden = true),
        CompositorMessage::SurfacePace(m) => set(drawing, |s| s.fps = m.fps as u32),
        CompositorMessage::SurfaceRelease(m) => set(drawing, |s| s.released(m.frame)),
        CompositorMessage::SurfaceDesk(m) => page(plugin, drawing, &m.surface, &m.message)?,
        // Out of the live budget: keep the angle for the next wake, and exit.
        CompositorMessage::SurfaceSleep(m) => {
            let angle = drawing.as_ref().map_or(0.0, |d| d.shown.angle);
            plugin.keep(&m.surface, json!({ "angle": angle }))?;
            return Ok(false);
        }
        CompositorMessage::SurfaceDestroy(_) => return Ok(false),
        other => {
            if let Some(d) = drawing.as_mut() {
                input(plugin, d, other)?;
            }
        }
    }
    Ok(true)
}

/// Input, the focus and the accessibility tree: what the parts (`parts.rs`) and the scene do.
fn input(plugin: &Plugin, d: &mut Drawing, message: CompositorMessage) -> io::Result<()> {
    let act = match message {
        // Tab or Shift+Tab came in; past either end the focus goes back (`act.leave`).
        CompositorMessage::SurfaceFocusEnter(m) => d.controls.enter(m.edge),
        CompositorMessage::SurfaceFocusIn(_) => {
            d.controls.keys = true;
            Act::default()
        }
        CompositorMessage::SurfaceFocusOut(_) => {
            d.controls.keys = false;
            Act::default()
        }
        CompositorMessage::SurfaceKeyDown(m) => d.controls.key(&m),
        // A click on a part presses it; anywhere else it changes the colour.
        CompositorMessage::SurfacePointerDown(m) => {
            (d.controls).click(d.shown.size, m.x, m.y).unwrap_or(Act {
                colour: true,
                ..Act::default()
            })
        }
        CompositorMessage::SurfaceA11yEnable(m) => {
            d.controls.enable(m.enabled);
            Act::changed()
        }
        CompositorMessage::SurfaceA11yAction(m) => d.controls.action(m.node, m.action),
        _ => Act::default(),
    };
    if act.colour {
        d.hue = (d.hue + 0.17) % 1.0;
    }
    if act.changed {
        tell(plugin, d)?;
    }
    if let Some(edge) = act.leave {
        plugin.leave_focus(&d.shown.surface, edge)?;
    }
    Ok(())
}

/// The parts' accessibility update, while the desk asks for the tree.
fn tell(plugin: &Plugin, d: &mut Drawing) -> io::Result<()> {
    let Some(update) = d.controls.update(&d.shown.surface, d.shown.size) else {
        return Ok(());
    };
    let update: SurfaceMessage = serde_json::from_value(update)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    plugin.send(&update)
}

/// The desk's page messages: `desk:init` hands back the angle the plugin kept (`restored`, what it
/// answered `ui.surface.state` with before it last slept, or its last `desk:state`); the desk asks
/// `ui.surface.state` before it takes the surface away (ADR 0070).
fn page(
    plugin: &Plugin,
    drawing: &mut Option<Drawing>,
    surface: &str,
    message: &serde_json::Map<String, Value>,
) -> io::Result<()> {
    let angle = drawing.as_ref().map_or(0.0, |d| d.shown.angle);
    match message.get("type").and_then(Value::as_str) {
        Some("desk:init") => {
            let kept = |field: &str| message.get(field)?.get("angle")?.as_f64();
            if let (Some(angle), Some(d)) = (kept("restored").or(kept("state")), drawing.as_mut()) {
                d.shown.angle = angle as f32;
            }
        }
        Some("desk:command") if message.get("name") == Some(&json!("ui.surface.state")) => {
            let call = message.get("call").cloned().unwrap_or(Value::Null);
            let reply = json!({ "type": "desk:reply", "call": call, "ok": true,
                "result": { "state": { "angle": angle } } });
            plugin.post(surface, reply)?;
        }
        _ => {}
    }
    Ok(())
}

fn set(drawing: &mut Option<Drawing>, change: impl FnOnce(&mut Shown)) {
    if let Some(d) = drawing.as_mut() {
        change(&mut d.shown);
    }
}

/// The surface is made (or woken in this new process): hello, and the window's title.
fn start(plugin: &Plugin, drawing: &mut Option<Drawing>, shown: Shown) -> io::Result<()> {
    plugin.hello(&shown.surface)?;
    plugin.title(&shown.surface, "Native wgpu")?;
    *drawing = Some(Drawing {
        shown,
        texture: None,
        hue: 0.58,
        last: Instant::now(),
        controls: Controls::new(),
    });
    Ok(())
}

/// Draw a frame and attach it.
fn draw(plugin: &Plugin, gpu: &Gpu, d: &mut Drawing, speed: f32) -> io::Result<()> {
    let now = Instant::now();
    if !d.controls.paused {
        d.shown
            .turn(now.duration_since(d.last).as_secs_f32(), speed);
    }
    d.last = now;
    let pixels = d.shown.pixels();
    if d.texture.as_ref().is_none_or(|(t, _)| t.size() != pixels) {
        let texture = SharedTexture::new(&gpu.device, pixels).map_err(io::Error::other)?;
        d.texture = Some((texture, false));
    }
    let Some((texture, sent)) = d.texture.as_mut() else {
        return Ok(());
    };
    let (parts, ring, paused) = d.controls.drawn(d.shown.size, d.shown.scale);
    let look = Look {
        angle: d.shown.angle,
        hue: d.hue,
        parts,
        ring,
        paused,
    };
    gpu.draw(texture.texture(), pixels, &look);
    let first = d.shown.frame == 0;
    let frame = d.shown.drew(now);
    let mut handle = json!({ "kind": "iosurface", "id": texture.id() });
    if !*sent {
        handle["portIndex"] = json!(0);
    }
    let attach = json!({ "type": "attach", "surface": d.shown.surface, "frame": frame,
        "texture": { "id": 1, "generation": d.shown.generation, "width": pixels.0,
            "height": pixels.1, "format": "bgra8", "handle": handle },
        "damage": [{ "x": 0, "y": 0, "width": pixels.0, "height": pixels.1 }],
        "release": "after-copy" });
    let attach: SurfaceAttach = serde_json::from_value(attach)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    plugin.attach(&attach, (!*sent).then(|| texture.surface()))?;
    *sent = true;
    if first {
        plugin.ready(&d.shown.surface)?;
    }
    Ok(())
}
