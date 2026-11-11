//! The compositor window's GPU: Metal, DX12 or Vulkan as #32 §10 says, a device on the adapter that
//! presents to the window (the one CEF renders with), and the window's swapchain. Headless
//! (`DESK_COMPOSITOR_HEADLESS=1`) composes only for the router and the captures. A frame the OS
//! withholds (`Occluded`: a locked screen, out of sight without winit saying so) is not asked for
//! again for `WITHHELD` (#134): the window composed it for nothing at every desk frame.
//!
//! A window that hands out no image in time (a locked screen, a display going off) stops presenting
//! for `PAUSED`, or until it shows again (#155). Its surface stays all the while: a frame taken from
//! it may still be in hand, and wgpu panics on one whose surface is gone ("Cannot get non-existent
//! resource SurfaceId", the desk ending in the middle of a resize).

use std::sync::Arc;
use std::time::{Duration, Instant};

use winit::window::Window;

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub format: wgpu::TextureFormat,
    pub adapter: wgpu::AdapterInfo,
    surface: Option<(wgpu::Surface<'static>, wgpu::SurfaceConfiguration)>,
    /// The OS withheld the last frame asked for, or handed out none in time: when to ask again.
    withheld: Option<Instant>,
    /// Presenting stopped until `withheld` (`stop_presenting`), or the window shows again.
    paused: bool,
}

/// How long the window waits before it asks again for a frame the OS withheld.
pub const WITHHELD: Duration = Duration::from_secs(1);
/// How long a window that handed out no image in time presents nothing before it asks again: an
/// ask that comes late holds the event loop up to a second.
pub const PAUSED: Duration = Duration::from_secs(10);

fn backends() -> wgpu::Backends {
    if cfg!(target_os = "macos") {
        wgpu::Backends::METAL
    } else if cfg!(target_os = "windows") {
        wgpu::Backends::DX12
    } else {
        wgpu::Backends::VULKAN
    }
}

fn instance() -> wgpu::Instance {
    wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: backends(),
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    })
}

impl Gpu {
    /// A device for `window`, presenting to it unless `headless`.
    pub fn new(window: Arc<Window>, headless: bool) -> Result<Gpu, String> {
        let instance = instance();
        let surface = if headless {
            None
        } else {
            Some(
                instance
                    .create_surface(Arc::clone(&window))
                    .map_err(|e| e.to_string())?,
            )
        };
        let size = window.inner_size();
        Gpu::on(&instance, surface, (size.width, size.height))
    }

    /// A device on `instance` that presents to `surface` (none: headless), `size` its pixels.
    fn on(
        instance: &wgpu::Instance,
        surface: Option<wgpu::Surface<'static>>,
        size: (u32, u32),
    ) -> Result<Gpu, String> {
        let request = |force_fallback_adapter| {
            pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: surface.as_ref(),
                force_fallback_adapter,
                ..Default::default()
            }))
        };
        // The compositor is the only desk (#83): without a GPU adapter it takes the backend's
        // software one (WARP, lavapipe) rather than open no desk at all.
        let adapter = request(false)
            .or_else(|first| {
                eprintln!("endue Desk: no GPU adapter ({first}); trying a software one");
                request(true)
            })
            .map_err(|e| e.to_string())?;
        // Windows and Linux import CEF's shared textures through these when the backend is Vulkan.
        let wanted = wgpu::Features::VULKAN_EXTERNAL_MEMORY_DMA_BUF
            | wgpu::Features::VULKAN_EXTERNAL_MEMORY_WIN32;
        let required_features = adapter.features() & wanted;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("desk compositor"),
            required_features,
            required_limits: wgpu::Limits::default().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| e.to_string())?;
        let (surface, format) = match surface {
            Some(surface) => {
                let caps = surface.get_capabilities(&adapter);
                let format = caps
                    .formats
                    .iter()
                    .copied()
                    .find(|f| !f.is_srgb())
                    .unwrap_or(caps.formats[0]);
                let config = wgpu::SurfaceConfiguration {
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    format,
                    width: size.0.max(1),
                    height: size.1.max(1),
                    present_mode: wgpu::PresentMode::AutoVsync,
                    desired_maximum_frame_latency: 2,
                    alpha_mode: caps.alpha_modes[0],
                    view_formats: vec![],
                    color_space: wgpu::SurfaceColorSpace::Auto,
                };
                surface.configure(&device, &config);
                (Some((surface, config)), format)
            }
            None => (None, wgpu::TextureFormat::Bgra8Unorm),
        };
        Ok(Gpu {
            device,
            queue,
            format,
            adapter: adapter.get_info(),
            surface,
            withheld: None,
            paused: false,
        })
    }

    /// Follow the window's new size.
    pub fn resize(&mut self, width: u32, height: u32) {
        if let Some((surface, config)) = self.surface.as_mut() {
            config.width = width.max(1);
            config.height = height.max(1);
            surface.configure(&self.device, config);
        }
    }

    /// The next swapchain image, when the window can present one. Asked for, it presents again.
    pub fn frame(&mut self) -> Option<wgpu::SurfaceTexture> {
        let (surface, config) = self.surface.as_ref()?;
        self.withheld = None;
        self.paused = false;
        match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some(frame),
            wgpu::CurrentSurfaceTexture::Occluded => {
                self.withheld = Some(Instant::now() + WITHHELD);
                None
            }
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                surface.configure(&self.device, config);
                None
            }
            _ => None,
        }
    }

    /// Whether a composed frame goes to the window: not headless, and not stopped.
    pub fn presents(&self) -> bool {
        self.surface.is_some() && !self.paused
    }

    /// When to ask again for a frame the OS withheld (`None`: it did not).
    pub fn withheld(&self) -> Option<Instant> {
        self.withheld
    }

    /// Present nothing for `PAUSED` from `now` (the window hands out no image in time), and keep the
    /// surface: a frame of it may be in hand, and is presented or dropped as any other.
    pub fn stop_presenting(&mut self, now: Instant) {
        if self.surface.is_some() {
            self.paused = true;
            self.withheld = Some(now + PAUSED);
        }
    }

    /// The window shows again: frames go to it from the next one on.
    pub fn resume(&mut self) {
        if std::mem::take(&mut self.paused) {
            self.withheld = None;
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
#[path = "gpu_tests.rs"]
mod tests;
