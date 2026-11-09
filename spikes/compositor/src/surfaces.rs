//! One off-screen CEF browser per surface. Its render handler imports every accelerated paint into
//! a wgpu texture the compositor samples; its display and request handlers report console lines
//! and renderer deaths. All callbacks run on the CEF UI thread, which is the main thread here.

use cef::*;
use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

pub struct Slot {
    pub url: String,
    pub created: Instant,
    pub first_paint: Option<Duration>,
    pub paints: u64,
    pub software_paints: u64,
    pub texture: Option<wgpu::Texture>,
    pub generation: u64,
    pub import_errors: u64,
    pub import_time: Duration,
    pub terminated: Vec<String>,
    pub reload_requested: bool,
    pub console: Vec<String>,
    pub ime_bounds: Vec<String>,
}

pub struct Shared {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub view: (u32, u32),
    pub scale: f32,
    pub start: Instant,
    pub slots: Vec<Slot>,
}

pub type SharedRc = Rc<RefCell<Shared>>;

impl Shared {
    pub fn add(&mut self, url: String) -> usize {
        self.slots.push(Slot {
            url,
            created: Instant::now(),
            first_paint: None,
            paints: 0,
            software_paints: 0,
            texture: None,
            generation: 0,
            import_errors: 0,
            import_time: Duration::ZERO,
            terminated: vec![],
            reload_requested: false,
            console: vec![],
            ime_bounds: vec![],
        });
        self.slots.len() - 1
    }
}

wrap_render_handler! {
    pub struct SurfaceRender {
        shared: SharedRc,
        index: usize,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (w, h) = self.shared.borrow().view;
                rect.x = 0;
                rect.y = 0;
                rect.width = w as _;
                rect.height = h as _;
            }
        }

        fn screen_info(&self, _browser: Option<&mut Browser>, info: Option<&mut ScreenInfo>) -> ::std::os::raw::c_int {
            let Some(info) = info else { return 0 };
            info.device_scale_factor = self.shared.borrow().scale;
            1
        }

        fn on_accelerated_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            _dirty_rects: Option<&[Rect]>,
            info: Option<&AcceleratedPaintInfo>,
        ) {
            use cef::osr_texture_import::SharedTextureHandle;
            let Some(info) = info else { return };
            if type_ != PaintElementType::default() {
                return;
            }
            let (device, queue) = {
                let shared = self.shared.borrow();
                (shared.device.clone(), shared.queue.clone())
            };
            let handle = SharedTextureHandle::new(info);
            let began = Instant::now();
            // SAFETY: inside CEF's paint callback, with a Metal/D3D12/Vulkan device on CEF's GPU.
            let imported = unsafe { handle.import_texture(&device, &queue) };
            let took = began.elapsed();
            let mut shared = self.shared.borrow_mut();
            let slot = &mut shared.slots[self.index];
            match imported {
                Ok(texture) => {
                    if slot.first_paint.is_none() {
                        slot.first_paint = Some(slot.created.elapsed());
                    }
                    slot.paints += 1;
                    slot.import_time += took;
                    slot.texture = Some(texture);
                    slot.generation += 1;
                }
                Err(error) => {
                    slot.import_errors += 1;
                    if slot.import_errors < 4 {
                        eprintln!("spike: surface {} import failed: {error}", self.index);
                    }
                }
            }
        }

        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            _type_: PaintElementType,
            _dirty_rects: Option<&[Rect]>,
            _buffer: *const u8,
            _width: ::std::os::raw::c_int,
            _height: ::std::os::raw::c_int,
        ) {
            // Software paints mean the shared-texture path is off; count them, never draw them.
            self.shared.borrow_mut().slots[self.index].software_paints += 1;
        }

        fn on_ime_composition_range_changed(
            &self,
            _browser: Option<&mut Browser>,
            selected: Option<&Range>,
            bounds: Option<&[Rect]>,
        ) {
            let text = format!(
                "selected={:?} bounds={:?}",
                selected.map(|r| (r.from, r.to)),
                bounds.map(|b| b.iter().map(|r| (r.x, r.y, r.width, r.height)).collect::<Vec<_>>())
            );
            self.shared.borrow_mut().slots[self.index].ime_bounds.push(text);
        }
    }
}

wrap_display_handler! {
    pub struct SurfaceDisplay {
        shared: SharedRc,
        index: usize,
    }

    impl DisplayHandler {
        fn on_console_message(
            &self,
            _browser: Option<&mut Browser>,
            _level: LogSeverity,
            message: Option<&CefString>,
            _source: Option<&CefString>,
            _line: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            if let Some(message) = message {
                let text = message.to_string();
                let mut shared = self.shared.borrow_mut();
                let at = shared.start.elapsed().as_secs_f32();
                println!("[{at:6.2}s] surface {}: {text}", self.index);
                shared.slots[self.index].console.push(text);
            }
            1
        }
    }
}

wrap_request_handler! {
    pub struct SurfaceRequests {
        shared: SharedRc,
        index: usize,
    }

    impl RequestHandler {
        fn on_render_process_terminated(
            &self,
            _browser: Option<&mut Browser>,
            status: TerminationStatus,
            error_code: ::std::os::raw::c_int,
            _error_string: Option<&CefString>,
        ) {
            let mut shared = self.shared.borrow_mut();
            let at = shared.start.elapsed().as_secs_f32();
            let what = format!("at {at:.2}s status={:?} code={error_code}", status.as_ref());
            println!("[{at:6.2}s] surface {}: renderer terminated ({what})", self.index);
            let slot = &mut shared.slots[self.index];
            slot.terminated.push(what);
            slot.reload_requested = true;
        }
    }
}

wrap_client! {
    pub struct SurfaceClient {
        render: RenderHandler,
        display: DisplayHandler,
        requests: RequestHandler,
    }

    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> {
            Some(self.render.clone())
        }
        fn display_handler(&self) -> Option<DisplayHandler> {
            Some(self.display.clone())
        }
        fn request_handler(&self) -> Option<RequestHandler> {
            Some(self.requests.clone())
        }
    }
}

/// Create the off-screen browser of surface `index`.
pub fn create(shared: &SharedRc, index: usize, frame_rate: i32) -> Browser {
    let url = shared.borrow().slots[index].url.clone();
    let window_info = WindowInfo {
        windowless_rendering_enabled: 1,
        shared_texture_enabled: 1,
        external_begin_frame_enabled: 1,
        ..Default::default()
    };
    let settings = BrowserSettings {
        windowless_frame_rate: frame_rate,
        ..Default::default()
    };
    let mut client = SurfaceClient::new(
        SurfaceRender::new(shared.clone(), index),
        SurfaceDisplay::new(shared.clone(), index),
        SurfaceRequests::new(shared.clone(), index),
    );
    shared.borrow_mut().slots[index].created = Instant::now();
    browser_host_create_browser_sync(
        Some(&window_info),
        Some(&mut client),
        Some(&url.as_str().into()),
        Some(&settings),
        None,
        None,
    )
    .expect("CEF creates the browser")
}
