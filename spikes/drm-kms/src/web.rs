//! One CEF windowless browser as the plugin window (`--features cef`, `--cef-url=...`). On a bare
//! VT there is no X11 or Wayland display for Chromium's Ozone layer, so the browser process starts
//! with `--ozone-platform=headless`: Ozone's headless platform has no windows of its own, and a
//! windowless browser needs none. Paints arrive as BGRA software frames (`OnPaint`) by default, or
//! as DMA-BUFs (`OnAcceleratedPaint`, `--cef-shared-texture`) that the `cef` crate imports into
//! our Vulkan device. CEF's subprocesses are this same binary (`subprocess` runs them).

use cef::*;
use std::cell::{Cell, RefCell};
use std::process::ExitCode;
use std::rc::Rc;
use std::time::{Duration, Instant};

type PumpDue = Rc<Cell<Instant>>;

/// The longest wait between two pump calls, as cefclient's `kMaxTimerDelay`.
const MAX_PUMP_DELAY: Duration = Duration::from_millis(1000 / 30);

/// Switches every desk-less run needs; `--cef-switch` adds to them.
const DEFAULT_SWITCHES: &[&str] = &[
    "ozone-platform=headless",
    "noerrdialogs",
    "hide-crash-restore-bubble",
];

wrap_browser_process_handler! {
    struct DeskBrowserProcess {
        due: PumpDue,
    }

    impl BrowserProcessHandler {
        fn on_schedule_message_pump_work(&self, delay_ms: i64) {
            let at = Instant::now() + Duration::from_millis(delay_ms.max(0) as u64).min(MAX_PUMP_DELAY);
            if at < self.due.get() {
                self.due.set(at);
            }
        }
    }
}

wrap_app! {
    struct DeskApp {
        switches: Vec<String>,
        due: PumpDue,
    }

    impl App {
        fn on_before_command_line_processing(&self, _process_type: Option<&CefStringUtf16>, command_line: Option<&mut CommandLine>) {
            let Some(command_line) = command_line else { return };
            for switch in DEFAULT_SWITCHES.iter().copied().chain(self.switches.iter().map(String::as_str)) {
                match switch.split_once('=') {
                    Some((name, value)) => command_line.append_switch_with_value(Some(&name.into()), Some(&value.into())),
                    None => command_line.append_switch(Some(&switch.into())),
                }
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(DeskBrowserProcess::new(self.due.clone()))
        }
    }
}

/// The newest frame the browser painted, as a texture of our device.
struct Paint {
    device: wgpu::Device,
    queue: wgpu::Queue,
    view: (u32, u32),
    texture: Option<wgpu::Texture>,
    generation: u64,
    taken: u64,
    software: u64,
    accelerated: u64,
    errors: u64,
}

impl Paint {
    /// A BGRA frame from `OnPaint` into our texture (a new one when the size changed).
    fn upload(&mut self, pixels: &[u8], size: (u32, u32)) {
        let extent = wgpu::Extent3d {
            width: size.0,
            height: size.1,
            depth_or_array_layers: 1,
        };
        if self
            .texture
            .as_ref()
            .is_none_or(|t| (t.width(), t.height()) != size)
        {
            self.texture = Some(self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("desk-kms plugin"),
                size: extent,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Bgra8Unorm,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            }));
        }
        let texture = self.texture.as_ref().expect("a texture");
        let layout = wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size.0 * 4),
            rows_per_image: Some(size.1),
        };
        self.queue
            .write_texture(texture.as_image_copy(), pixels, layout, extent);
        self.generation += 1;
    }
}

wrap_render_handler! {
    struct PluginRender {
        paint: Rc<RefCell<Paint>>,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (w, h) = self.paint.borrow().view;
                *rect = Rect { x: 0, y: 0, width: w as i32, height: h as i32 };
            }
        }

        fn screen_info(&self, _browser: Option<&mut Browser>, info: Option<&mut ScreenInfo>) -> ::std::os::raw::c_int {
            let Some(info) = info else { return 0 };
            info.device_scale_factor = 1.0;
            1
        }

        fn on_paint(&self, _browser: Option<&mut Browser>, type_: PaintElementType, _dirty: Option<&[Rect]>, buffer: *const u8, width: ::std::os::raw::c_int, height: ::std::os::raw::c_int) {
            if type_ != PaintElementType::default() || buffer.is_null() || width <= 0 || height <= 0 {
                return;
            }
            let size = (width as u32, height as u32);
            // SAFETY: CEF passes width * height * 4 bytes of BGRA, valid for this call.
            let pixels = unsafe { std::slice::from_raw_parts(buffer, (size.0 * size.1 * 4) as usize) };
            let mut paint = self.paint.borrow_mut();
            paint.upload(pixels, size);
            paint.software += 1;
        }

        fn on_accelerated_paint(&self, _browser: Option<&mut Browser>, type_: PaintElementType, _dirty: Option<&[Rect]>, info: Option<&AcceleratedPaintInfo>) {
            use cef::osr_texture_import::SharedTextureHandle;
            let Some(info) = info else { return };
            if type_ != PaintElementType::default() {
                return;
            }
            let (device, queue) = {
                let paint = self.paint.borrow();
                (paint.device.clone(), paint.queue.clone())
            };
            // SAFETY: inside CEF's paint callback, on a Vulkan device of the GPU CEF renders on.
            let imported = unsafe { SharedTextureHandle::new(info).import_texture(&device, &queue) };
            let mut paint = self.paint.borrow_mut();
            match imported {
                Ok(texture) => {
                    paint.texture = Some(texture);
                    paint.generation += 1;
                    paint.accelerated += 1;
                }
                Err(e) => {
                    paint.errors += 1;
                    if paint.errors < 4 {
                        eprintln!("web: DMA-BUF import failed: {e}");
                    }
                }
            }
        }
    }
}

wrap_client! {
    struct PluginClient {
        render: RenderHandler,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render.clone())
        }
    }
}

/// CEF runs its renderer, GPU, utility and zygote processes from this binary with `--type=...`:
/// run one and return its exit code, or `None` in the browser process. Call it first in `main`,
/// before any seat or DRM call, so subprocesses never touch the display.
pub fn subprocess() -> Option<ExitCode> {
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);
    let args = cef::args::Args::new();
    let mut app = DeskApp::new(vec![], Rc::new(Cell::new(Instant::now())));
    // As cefsimple: returns -1 at once in the browser process, else runs the subprocess.
    let code = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    (code >= 0).then(|| ExitCode::from(code.min(255) as u8))
}

pub struct Web {
    browser: Browser,
    paint: Rc<RefCell<Paint>>,
    due: PumpDue,
    composing: Option<String>,
}

impl Web {
    pub fn start(
        url: &str,
        switches: &[String],
        shared_texture: bool,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        view: (u32, u32),
    ) -> Result<Web, String> {
        let args = cef::args::Args::new();
        let due: PumpDue = Rc::new(Cell::new(Instant::now()));
        let mut app = DeskApp::new(switches.to_vec(), due.clone());
        let cache = std::env::temp_dir().join(format!("desk-kms-cef-{}", std::process::id()));
        let settings = Settings {
            windowless_rendering_enabled: 1,
            external_message_pump: 1,
            // The spike runs unsandboxed: the sandbox needs chrome-sandbox setuid or user namespaces.
            no_sandbox: 1,
            root_cache_path: cache.to_string_lossy().as_ref().into(),
            log_severity: LogSeverity::WARNING,
            ..Default::default()
        };
        if cef::initialize(
            Some(args.as_main_args()),
            Some(&settings),
            Some(&mut app),
            std::ptr::null_mut(),
        ) != 1
        {
            return Err("CEF did not initialise (see its log; libcef.so and its resources must sit next to the binary)".into());
        }
        let paint = Rc::new(RefCell::new(Paint {
            device: device.clone(),
            queue: queue.clone(),
            view,
            texture: None,
            generation: 0,
            taken: 0,
            software: 0,
            accelerated: 0,
            errors: 0,
        }));
        let window_info = WindowInfo {
            windowless_rendering_enabled: 1,
            shared_texture_enabled: i32::from(shared_texture),
            ..Default::default()
        };
        let browser_settings = BrowserSettings {
            windowless_frame_rate: 60,
            ..Default::default()
        };
        let mut client = PluginClient::new(PluginRender::new(paint.clone()));
        let browser = browser_host_create_browser_sync(
            Some(&window_info),
            Some(&mut client),
            Some(&url.into()),
            Some(&browser_settings),
            None,
            None,
        )
        .ok_or("CEF did not create the browser")?;
        println!(
            "web: windowless browser for {url} at {}x{}, shared texture {shared_texture}",
            view.0, view.1
        );
        Ok(Web {
            browser,
            paint,
            due,
            composing: None,
        })
    }

    /// Run CEF's work when it asked for it (or after the longest delay).
    pub fn pump(&self) {
        let now = Instant::now();
        if now >= self.due.get() {
            self.due.set(now + MAX_PUMP_DELAY);
            cef::do_message_loop_work();
        }
    }

    /// The texture to show, when the browser painted since the last call.
    pub fn take_paint(&self) -> Option<wgpu::Texture> {
        let mut paint = self.paint.borrow_mut();
        if paint.generation == paint.taken {
            return None;
        }
        paint.taken = paint.generation;
        paint.texture.clone()
    }

    pub fn stats(&self) -> String {
        let p = self.paint.borrow();
        format!(
            "plugin paints: {} software, {} accelerated, {} import errors",
            p.software, p.accelerated, p.errors
        )
    }

    /// A surface protocol message the compositor's router sent to the plugin surface.
    pub fn deliver(&mut self, message: &desk_surface::CompositorMessage) {
        if let Some(host) = self.browser.host() {
            crate::web_input::deliver(&host, message, &mut self.composing);
        }
    }

    pub fn shutdown(self) {
        if let Some(host) = self.browser.host() {
            host.close_browser(1);
        }
        for _ in 0..30 {
            cef::do_message_loop_work();
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(self.browser);
        cef::shutdown();
    }
}
