//! Command-line options of the spike. CEF passes its own switches too; unknown ones are ignored.

#[derive(Clone, Debug)]
pub struct Options {
    /// How many off-screen browsers to run.
    pub surfaces: usize,
    /// Which page each surface loads: `light`, `heavy`, `webgpu` or `ime`.
    pub page: String,
    /// Logical size of each surface's view.
    pub view: (u32, u32),
    /// Device scale factor CEF renders at.
    pub scale: f32,
    /// Size of the composed frame.
    pub frame: (u32, u32),
    /// Seconds after start at which the composed frame is written as PNG.
    pub capture_at: Vec<f32>,
    /// PNG path prefix; `-<n>.png` is appended.
    pub capture: String,
    /// Seconds after start at which one renderer process is killed.
    pub kill_at: Option<f32>,
    /// Seconds after start at which the spike exits and prints its report.
    pub exit_at: f32,
    /// Rotate the quads (degrees about Y) to prove arbitrary transforms.
    pub tilt: f32,
    /// Extra Chromium switches, e.g. `enable-unsafe-webgpu`.
    pub switches: Vec<String>,
    /// Drive the IME API with a Korean composition once the page loads.
    pub ime_script: bool,
    /// Never present to the window (a locked screen blocks on every drawable).
    pub headless: bool,
    /// Seconds after start at which every surface's view is resized to `resize_to`.
    pub resize_at: Option<f32>,
    pub resize_to: (u32, u32),
}

impl Options {
    pub fn parse() -> Self {
        let mut options = Options {
            surfaces: 1,
            page: "light".into(),
            view: (800, 600),
            scale: 2.0,
            frame: (1920, 1080),
            capture_at: vec![],
            capture: "spike".into(),
            kill_at: None,
            exit_at: 8.0,
            tilt: 15.0,
            switches: vec![],
            ime_script: false,
            headless: false,
            resize_at: None,
            resize_to: (1024, 640),
        };
        for arg in std::env::args().skip(1) {
            let Some(rest) = arg.strip_prefix("--spike-") else {
                continue;
            };
            let (name, value) = rest.split_once('=').unwrap_or((rest, ""));
            match name {
                "surfaces" => options.surfaces = value.parse().unwrap_or(1),
                "page" => options.page = value.to_owned(),
                "view" => options.view = pair(value).unwrap_or(options.view),
                "scale" => options.scale = value.parse().unwrap_or(2.0),
                "frame" => options.frame = pair(value).unwrap_or(options.frame),
                "capture-at" => {
                    options.capture_at = value.split(',').filter_map(|v| v.parse().ok()).collect()
                }
                "capture" => options.capture = value.to_owned(),
                "kill-at" => options.kill_at = value.parse().ok(),
                "exit-at" => options.exit_at = value.parse().unwrap_or(8.0),
                "tilt" => options.tilt = value.parse().unwrap_or(15.0),
                "switch" => options.switches.push(value.to_owned()),
                "ime" => options.ime_script = true,
                "headless" => options.headless = true,
                "resize-at" => options.resize_at = value.parse().ok(),
                "resize-to" => options.resize_to = pair(value).unwrap_or(options.resize_to),
                _ => eprintln!("spike: unknown option --spike-{name}"),
            }
        }
        options
    }
}

fn pair(value: &str) -> Option<(u32, u32)> {
    let (a, b) = value.split_once('x')?;
    Some((a.parse().ok()?, b.parse().ok()?))
}
