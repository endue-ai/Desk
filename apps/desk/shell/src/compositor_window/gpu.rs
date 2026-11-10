//! The compositor window's GPU: Metal, DX12 or Vulkan as #32 §10 says, a device on the adapter that
//! presents to the window (the one CEF renders with), and the window's swapchain. Headless
//! (`DESK_COMPOSITOR_HEADLESS=1`, or a locked screen that never hands out a drawable) composes only
//! on request, for a capture.

use std::sync::Arc;

use winit::window::Window;

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub format: wgpu::TextureFormat,
    pub adapter: wgpu::AdapterInfo,
    surface: Option<(wgpu::Surface<'static>, wgpu::SurfaceConfiguration)>,
}

fn backends() -> wgpu::Backends {
    if cfg!(target_os = "macos") {
        wgpu::Backends::METAL
    } else if cfg!(target_os = "windows") {
        wgpu::Backends::DX12
    } else {
        wgpu::Backends::VULKAN
    }
}

impl Gpu {
    /// A device for `window`, presenting to it unless `headless`.
    pub fn new(window: Arc<Window>, headless: bool) -> Result<Gpu, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: backends(),
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let surface = if headless {
            None
        } else {
            Some(
                instance
                    .create_surface(Arc::clone(&window))
                    .map_err(|e| e.to_string())?,
            )
        };
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
        let size = window.inner_size();
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
                    width: size.width.max(1),
                    height: size.height.max(1),
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

    /// The next swapchain image, when the window can present one.
    pub fn frame(&mut self) -> Option<wgpu::SurfaceTexture> {
        let (surface, config) = self.surface.as_ref()?;
        match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Some(frame),
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                surface.configure(&self.device, config);
                None
            }
            _ => None,
        }
    }

    pub fn presents(&self) -> bool {
        self.surface.is_some()
    }

    /// Present no more (the window never hands out an image in time).
    pub fn stop_presenting(&mut self) {
        self.surface = None;
    }
}
