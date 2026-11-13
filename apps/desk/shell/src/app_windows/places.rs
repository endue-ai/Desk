//! Where each app's window was (#235): its place and size per display, and the display it was on
//! last, kept in `<data>/app-windows.json` once a window rests after a move or a resize, when it
//! closes and when the desk quits. An app opens on the display it was on last when that display
//! is still there, else on one it was ever on, where a display still shows its title bar
//! (`main_frame::Frame::opening_at_least`); else where the OS puts a new window. A display is
//! known by its name and size, so a laptop's screen and an external one keep places of their own.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use winit::event_loop::ActiveEventLoop;
use winit::monitor::MonitorHandle;
use winit::window::Window;

use crate::main_frame::{Frame, Opening};

const FILE: &str = "app-windows.json";

/// One display: its key and its work area, in points.
#[derive(Clone, Debug, PartialEq)]
pub struct Display {
    pub key: String,
    pub area: Frame,
}

/// One app's places.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Place {
    /// The display its window was on last.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<String>,
    /// Its frame on each display it was on.
    #[serde(default)]
    pub frames: BTreeMap<String, Frame>,
}

/// Every app's places.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Kept {
    #[serde(default)]
    pub apps: BTreeMap<String, Place>,
}

impl Kept {
    /// A kept file's places; one that cannot be read keeps none.
    pub fn parse(text: &str) -> Kept {
        serde_json::from_str(text).unwrap_or_default()
    }

    /// How app `plugin`'s window opens on `displays` (the primary first), never smaller than
    /// `least`; `None` when no display it was on is there.
    pub fn opening(
        &self,
        plugin: &str,
        displays: &[Display],
        least: (f64, f64),
    ) -> Option<Opening> {
        let place = self.apps.get(plugin)?;
        let present = |key: &str| displays.iter().any(|d| d.key == key);
        let key = (place.last.as_deref())
            .filter(|key| present(key) && place.frames.contains_key(*key))
            .or_else(|| {
                place
                    .frames
                    .keys()
                    .map(String::as_str)
                    .find(|key| present(key))
            })?;
        let frame = place.frames.get(key)?;
        let areas: Vec<Frame> = displays.iter().map(|d| d.area).collect();
        Some(frame.opening_at_least(&areas, least))
    }

    /// App `plugin`'s window rests at `frame` on display `display`: whether that changed anything.
    pub fn keep(&mut self, plugin: &str, display: &str, frame: Frame) -> bool {
        let place = self.apps.entry(plugin.to_owned()).or_default();
        let before = place.clone();
        place.last = Some(display.to_owned());
        place.frames.insert(display.to_owned(), frame);
        *place != before
    }
}

/// The places as the file holds them, read once.
fn kept() -> &'static Mutex<Kept> {
    static KEPT: OnceLock<Mutex<Kept>> = OnceLock::new();
    KEPT.get_or_init(|| {
        let text = std::fs::read_to_string(file()).unwrap_or_default();
        Mutex::new(Kept::parse(&text))
    })
}

fn file() -> PathBuf {
    crate::paths::data_dir().join(FILE)
}

/// How app `plugin`'s window opens on this machine's displays now.
pub fn opening(event_loop: &ActiveEventLoop, plugin: &str, least: (f64, f64)) -> Option<Opening> {
    let displays = displays(event_loop);
    let kept = kept().lock().unwrap_or_else(|e| e.into_inner());
    kept.opening(plugin, &displays, least)
}

/// Keep where app `plugin`'s `window` is now, when it is on a display and not away (full screen,
/// minimized, hidden); written to the file when that changed anything.
pub fn keep(plugin: &str, window: &Window) {
    let (Some(frame), Some(display)) = (
        crate::main_frame::frame_of(window),
        window.current_monitor().map(|m| key_of(&m)),
    ) else {
        return;
    };
    let mut kept = kept().lock().unwrap_or_else(|e| e.into_inner());
    if !kept.keep(plugin, &display, frame) {
        return;
    }
    let path = file();
    let text = serde_json::to_string_pretty(&*kept).unwrap_or_default();
    let saved = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let partial = path.with_extension("json.partial");
            std::fs::write(&partial, text).and_then(|()| std::fs::rename(&partial, &path))
        });
    if let Err(why) = saved {
        eprintln!(
            "endue Desk: the app windows' places were not kept in {} ({why})",
            path.display()
        );
    }
}

/// A display's key: its name and its size in points.
fn key_of(monitor: &MonitorHandle) -> String {
    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
    let name = monitor.name().unwrap_or_else(|| "display".to_owned());
    format!("{name} {}x{}", size.width.round(), size.height.round())
}

/// The displays and their work areas in points, the primary one first.
fn displays(event_loop: &ActiveEventLoop) -> Vec<Display> {
    let primary = event_loop.primary_monitor();
    let others = (event_loop.available_monitors()).filter(|m| Some(m) != primary.as_ref());
    let all: Vec<MonitorHandle> = primary.clone().into_iter().chain(others).collect();
    all.iter()
        .map(|monitor| {
            let area = crate::displays::work_area(monitor);
            let scale = monitor.scale_factor();
            let area = Frame {
                x: f64::from(area.x) / scale,
                y: f64::from(area.y) / scale,
                width: f64::from(area.width) / scale,
                height: f64::from(area.height) / scale,
            };
            Display {
                key: key_of(monitor),
                area,
            }
        })
        .collect()
}
