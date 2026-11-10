//! Command line: `--name=value` or `--flag`. Unknown arguments are an error in the browser process,
//! except Chromium's own (`--type=...` never reaches here: CEF subprocesses exit before parsing).

use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresentPath {
    /// wgpu's `SurfaceTargetUnsafe::Drm`: Vulkan `VK_KHR_display` + `VK_EXT_acquire_drm_display`.
    VkDisplay,
    /// wgpu renders off-screen, the frame is copied into a KMS dumb buffer, page flips are ours.
    Dumb,
    /// `VkDisplay`, then `Dumb` if the driver has no Vulkan display support.
    Auto,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeatKind {
    /// systemd-logind over D-Bus: TakeControl, TakeDevice, PauseDevice/ResumeDevice, SwitchTo.
    Logind,
    /// libseat (seatd, logind or builtin), with `--features libseat`.
    Libseat,
    /// Open the devices directly: root (or the video and input groups), no VT switching.
    Direct,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub list: bool,
    pub device: Option<PathBuf>,
    pub connector: Option<String>,
    pub mode: Option<(u16, u16, Option<u32>)>,
    pub present: PresentPath,
    pub seat: SeatKind,
    /// Vulkan display plane index; `None` asks the driver which planes show the display.
    pub plane: Option<u32>,
    pub seconds: f32,
    pub windows: usize,
    pub capture: Option<PathBuf>,
    pub capture_at: f32,
    pub verbose: bool,
    pub cef_url: Option<String>,
    pub cef_switches: Vec<String>,
    pub cef_shared_texture: bool,
}

const HELP: &str = "desk-kms: desk-compositor's demo desk on a bare Linux VT (spike for #60)

  --list                     print DRM devices, connectors, modes, planes and Vulkan displays; exit
  --device=/dev/dri/cardN    the KMS device (default: the first with a connected output)
  --connector=NAME           e.g. HDMI-A-1, eDP-1, Virtual-1 (default: the first connected)
  --mode=WxH[@Hz]            (default: the connector's preferred mode)
  --present=auto|vk-display|dumb   (default auto: vk-display, then dumb)
  --plane=N                  Vulkan display plane index for vk-display (default: asked)
  --seat=logind|libseat|direct     (default logind)
  --seconds=N                quit after N seconds; 0 runs until Ctrl+Alt+Backspace (default 30)
  --windows=N                demo windows (default 15)
  --capture=FILE.png         also write the composed frame at --capture-at seconds (default 3)
  --verbose                  print every input event as the compositor's Input
  --cef-url=URL              one CEF windowless browser as a plugin window (--features cef)
  --cef-switch=NAME[=VALUE]  an extra Chromium switch (repeatable)
  --cef-shared-texture       accelerated paint (DMA-BUF) instead of software paint

Keys: Ctrl+Alt+F1..F12 switch VT, Ctrl+Alt+Backspace quits.";

impl Options {
    pub fn parse() -> Result<Options, String> {
        let mut o = Options {
            list: false,
            device: None,
            connector: None,
            mode: None,
            present: PresentPath::Auto,
            seat: SeatKind::Logind,
            plane: None,
            seconds: 30.0,
            windows: 15,
            capture: None,
            capture_at: 3.0,
            verbose: false,
            cef_url: None,
            cef_switches: vec![],
            cef_shared_texture: false,
        };
        for arg in std::env::args().skip(1) {
            let (name, value) = match arg.split_once('=') {
                Some((n, v)) => (n.to_owned(), v.to_owned()),
                None => (arg.clone(), String::new()),
            };
            let number = |what: &str| -> Result<f32, String> {
                value
                    .parse()
                    .map_err(|_| format!("{what} wants a number, not {value:?}"))
            };
            match name.as_str() {
                "--help" | "-h" => return Err(HELP.into()),
                "--list" => o.list = true,
                "--device" => o.device = Some(PathBuf::from(&value)),
                "--connector" => o.connector = Some(value.clone()),
                "--mode" => o.mode = Some(parse_mode(&value)?),
                "--present" => {
                    o.present = match value.as_str() {
                        "auto" => PresentPath::Auto,
                        "vk-display" => PresentPath::VkDisplay,
                        "dumb" => PresentPath::Dumb,
                        other => {
                            return Err(format!("--present={other}: auto, vk-display or dumb"));
                        }
                    }
                }
                "--plane" => o.plane = Some(number("--plane")? as u32),
                "--seat" => {
                    o.seat = match value.as_str() {
                        "logind" => SeatKind::Logind,
                        "libseat" => SeatKind::Libseat,
                        "direct" => SeatKind::Direct,
                        other => return Err(format!("--seat={other}: logind, libseat or direct")),
                    }
                }
                "--seconds" => o.seconds = number("--seconds")?,
                "--windows" => o.windows = number("--windows")? as usize,
                "--capture" => o.capture = Some(PathBuf::from(&value)),
                "--capture-at" => o.capture_at = number("--capture-at")?,
                "--verbose" => o.verbose = true,
                "--cef-url" => o.cef_url = Some(value.clone()),
                "--cef-switch" => o.cef_switches.push(value.clone()),
                "--cef-shared-texture" => o.cef_shared_texture = true,
                other => return Err(format!("unknown option {other}\n\n{HELP}")),
            }
        }
        Ok(o)
    }
}

/// `1920x1080` or `1920x1080@60`.
fn parse_mode(text: &str) -> Result<(u16, u16, Option<u32>), String> {
    let bad = || format!("--mode={text}: WxH or WxH@Hz");
    let (size, hz) = match text.split_once('@') {
        Some((s, hz)) => (s, Some(hz.parse().map_err(|_| bad())?)),
        None => (text, None),
    };
    let (w, h) = size.split_once('x').ok_or_else(bad)?;
    Ok((
        w.parse().map_err(|_| bad())?,
        h.parse().map_err(|_| bad())?,
        hz,
    ))
}
