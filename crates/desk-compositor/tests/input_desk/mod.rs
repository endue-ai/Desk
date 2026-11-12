//! The desk the input tests share (#56): at scale 2 (2560 x 1600 device pixels), the shell page
//! under everything (`desk`, the underlay), plugin surface `a.one` at logical (100, 50) and `b.two`
//! at (600, 50), each 400 x 300. Pure CPU.
#![allow(dead_code)]

use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::input::keymap::{KeyEntry, Platform};
use desk_compositor::input::*;
use desk_compositor::*;
use desk_surface::generated::SurfaceMessage;

pub const PAGE: &str = "desk";
pub const A: &str = "a.one";
pub const B: &str = "b.two";

pub struct Desk {
    pub scene: Scene,
    pub router: InputRouter,
    pub now: Instant,
}

pub fn quad(
    scene: &mut Scene,
    router: &mut InputRouter,
    parent: NodeId,
    surface: &str,
    rect: Rect,
    origin: Vec2,
) -> NodeId {
    let node = scene
        .insert(parent, SurfaceNode::new(rect, TextureId(1)))
        .unwrap();
    let target = Target {
        surface: surface.into(),
        origin,
        per_unit: Vec2::splat(0.5),
    };
    router.targets.surface(scene, node, target);
    node
}

pub fn desk() -> Desk {
    let mut scene = Scene::new(2560, 1600);
    let settings = PointerSettings {
        underlay: Some(PAGE.into()),
        ..PointerSettings::default()
    };
    let mut router = InputRouter::new(Platform::Mac, settings);
    let root = scene.root();
    quad(
        &mut scene,
        &mut router,
        root,
        PAGE,
        Rect::new(0.0, 0.0, 2560.0, 1600.0),
        Vec2::ZERO,
    );
    quad(
        &mut scene,
        &mut router,
        root,
        A,
        Rect::new(200.0, 100.0, 800.0, 600.0),
        Vec2::ZERO,
    );
    quad(
        &mut scene,
        &mut router,
        root,
        B,
        Rect::new(1200.0, 100.0, 800.0, 600.0),
        Vec2::ZERO,
    );
    for (s, owner) in [(PAGE, "desk"), (A, "a"), (B, "b")] {
        router.targets.set_owner(s, owner);
    }
    Desk {
        scene,
        router,
        now: Instant::now(),
    }
}

impl Desk {
    pub fn feed(&mut self, input: Input) -> Vec<Out> {
        self.now += Duration::from_millis(16);
        self.router.handle(&self.scene, &input, self.now)
    }
    /// The pointer at logical point (x, y) of the window.
    pub fn to(&mut self, x: f32, y: f32) -> Vec<Out> {
        self.feed(Input::PointerMoved {
            x: x * 2.0,
            y: y * 2.0,
        })
    }
    pub fn press(&mut self, pressed: bool) -> Vec<Out> {
        self.feed(Input::PointerButton {
            button: Button::Left,
            pressed,
        })
    }
    pub fn click(&mut self, x: f32, y: f32) -> Vec<Out> {
        let mut out = self.to(x, y);
        out.extend(self.press(true));
        out.extend(self.press(false));
        out
    }
    pub fn key(&mut self, key: &str, code: &str, text: Option<&str>, mods: Modifiers) -> Vec<Out> {
        self.feed(Input::Modifiers(mods));
        let mut out = self.feed(Input::Key(KeyInput {
            key: key.into(),
            code: code.into(),
            text: text.map(Into::into),
            pressed: true,
            repeat: false,
        }));
        out.extend(self.feed(Input::Key(KeyInput {
            key: key.into(),
            code: code.into(),
            text: None,
            pressed: false,
            repeat: false,
        })));
        out
    }
    pub fn said(&mut self, message: SurfaceMessage) -> Vec<Out> {
        self.router.surface_message(&self.scene, &message, self.now)
    }
    /// The page answers a press on it or a key the desk ran: what was typed since goes on.
    pub fn answer(&mut self) -> Vec<Out> {
        self.router.page_answered(self.now)
    }
}

pub fn sent(out: &[Out]) -> Vec<serde_json::Value> {
    out.iter()
        .filter_map(|o| match o {
            Out::Send(m) => Some(serde_json::to_value(m).unwrap()),
            _ => None,
        })
        .collect()
}

/// `type@surface` for every message sent.
pub fn kinds(out: &[Out]) -> Vec<String> {
    sent(out)
        .iter()
        .map(|m| {
            format!(
                "{}@{}",
                m["type"].as_str().unwrap(),
                m["surface"].as_str().unwrap()
            )
        })
        .collect()
}

/// A message's point, to a thousandth of a pixel (the hit test meets the camera's ray in f32).
pub fn point(m: &serde_json::Value) -> (f64, f64) {
    let round = |v: f64| (v * 1000.0).round() / 1000.0;
    (
        round(m["x"].as_f64().unwrap()),
        round(m["y"].as_f64().unwrap()),
    )
}

pub fn near(a: Vec2, b: Vec2) -> bool {
    a.distance(b) < 1e-3
}

pub fn message(json: serde_json::Value) -> SurfaceMessage {
    serde_json::from_value(json).unwrap()
}

pub const NO_MODS: Modifiers = Modifiers {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    caps_lock: false,
};
pub const META: Modifiers = Modifiers {
    meta: true,
    ..NO_MODS
};
pub const CTRL: Modifiers = Modifiers {
    ctrl: true,
    ..NO_MODS
};

pub fn entry(key: &str, command: &str, owner: &str) -> KeyEntry {
    KeyEntry {
        key: key.into(),
        mac: None,
        command: command.into(),
        args: None,
        owner: owner.into(),
        source: None,
    }
}

/// a.one drags a path from a press at (110, 60); b.two takes paths and text, the page nothing.
pub fn dragging() -> Desk {
    let mut d = desk();
    d.said(message(serde_json::json!({ "type": "drag.accept", "surface": B, "types": ["desk/paths", "text/plain"] })));
    d.to(110.0, 60.0);
    d.press(true);
    let start = serde_json::json!({ "type": "drag.start", "surface": A, "effectAllowed": ["copy", "move", "link"],
        "items": [{ "type": "desk/paths", "paths": [{ "path": "~/Documents/a.md", "kind": "file" }] }] });
    assert!(
        sent(&d.said(message(start))).is_empty(),
        "taken: nothing to say yet"
    );
    assert!(d.router.broker().active());
    d
}
