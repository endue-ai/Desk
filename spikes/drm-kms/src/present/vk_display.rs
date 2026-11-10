//! wgpu straight onto the connector: `SurfaceTargetUnsafe::Drm` (wgpu 30, feature `drm`, Vulkan
//! only). wgpu-hal finds the physical device whose DRM node is our card, calls
//! `vkGetDrmDisplayEXT` + `vkAcquireDrmDisplayEXT` with our master fd, picks the Vulkan display
//! mode equal to (width, height, mHz) and creates a `VK_KHR_display` plane surface. From then on
//! it is an ordinary swapchain: FIFO presents flip once per vblank, inside the driver.

use super::Present;
use super::vk_probe;
use crate::kms::{self, Card, Output};
use std::os::fd::{AsFd, AsRawFd, BorrowedFd};
use std::rc::Rc;

pub struct VkDisplay {
    // Field order is drop order: the surface goes before the instance and the card's fd.
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter: wgpu::Adapter,
    config: wgpu::SurfaceConfiguration,
    _instance: wgpu::Instance,
    _card: Rc<Card>,
    plane: u32,
    paused: bool,
    presented: u64,
}

impl VkDisplay {
    pub fn new(card: Rc<Card>, output: &Output, plane: Option<u32>) -> Result<VkDisplay, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let (width, height) = output.size();
        let refresh_rate = kms::refresh_mhz(&output.mode);
        let connector_id: u32 = output.connector.into();
        let probe = vk_probe::probe(&instance, &card, connector_id)?;
        vk_probe::print(&probe);
        if !probe.extension {
            return Err("the Vulkan driver has no VK_EXT_acquire_drm_display".into());
        }
        if probe.device.is_none() {
            return Err("no Vulkan physical device is this card".into());
        }
        // wgpu looks the mode up by exact (width, height, mHz): take the driver's own number for
        // the mode nearest ours, in case its rounding differs from `kms::refresh_mhz`.
        let refresh_rate = probe
            .modes
            .iter()
            .filter(|(w, h, _)| (*w, *h) == (width, height))
            .map(|m| m.2)
            .min_by_key(|mhz| mhz.abs_diff(refresh_rate))
            .ok_or(format!("no Vulkan display mode is {width}x{height}"))?;
        let plane = plane.or(probe.planes.first().copied()).unwrap_or(0);
        let target = wgpu::SurfaceTargetUnsafe::Drm {
            fd: card.as_fd().as_raw_fd(),
            plane,
            connector_id,
            width,
            height,
            refresh_rate,
        };
        // wgpu-hal `expect`s on a failed acquire (another master, a driver that opened the card
        // itself): catch it so `--present=auto` can fall back to dumb buffers.
        let created = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // SAFETY: the fd, connector and mode are valid and `_card` keeps the fd open for as
            // long as the surface lives.
            unsafe { instance.create_surface_unsafe(target) }
        }));
        let surface = match created {
            Ok(Ok(surface)) => surface,
            Ok(Err(e)) => return Err(format!("DRM surface: {e}")),
            Err(_) => return Err("DRM surface: wgpu-hal panicked acquiring the display".into()),
        };
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            compatible_surface: Some(&surface),
            ..Default::default()
        }))
        .map_err(|e| format!("no adapter for the DRM surface: {e}"))?;
        // CEF's accelerated paint imports DMA-BUFs; ask for it where the driver has it.
        let wanted = wgpu::Features::VULKAN_EXTERNAL_MEMORY_DMA_BUF & adapter.features();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("desk-kms vk-display"),
            required_features: wanted,
            required_limits: wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits()),
            ..Default::default()
        }))
        .map_err(|e| format!("device: {e}"))?;
        let caps = surface.get_capabilities(&adapter);
        println!(
            "vk-display: formats {:?}, present modes {:?}, alpha {:?}",
            caps.formats, caps.present_modes, caps.alpha_modes
        );
        println!(
            "vk-display: HDR info {:?}",
            surface.display_hdr_info(&adapter)
        );
        let mut config = surface
            .get_default_config(&adapter, width, height)
            .ok_or("the DRM surface is not supported by the adapter")?;
        config.format =
            pick_format(&caps.formats).ok_or("the DRM surface offers no 8-bit format")?;
        config.present_mode = wgpu::PresentMode::Fifo;
        surface.configure(&device, &config);
        Ok(VkDisplay {
            surface,
            device,
            queue,
            adapter,
            config,
            _instance: instance,
            _card: card,
            plane,
            paused: false,
            presented: 0,
        })
    }
}

/// desk-compositor writes straight-alpha colours as they are: a non-sRGB 8-bit target, as the
/// demo and the tests use.
fn pick_format(formats: &[wgpu::TextureFormat]) -> Option<wgpu::TextureFormat> {
    use wgpu::TextureFormat as F;
    [
        F::Bgra8Unorm,
        F::Rgba8Unorm,
        F::Bgra8UnormSrgb,
        F::Rgba8UnormSrgb,
    ]
    .into_iter()
    .find(|f| formats.contains(f))
}

impl Present for VkDisplay {
    fn device(&self) -> &wgpu::Device {
        &self.device
    }
    fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }
    fn adapter(&self) -> wgpu::AdapterInfo {
        self.adapter.get_info()
    }
    fn format(&self) -> wgpu::TextureFormat {
        self.config.format
    }
    fn size(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }
    fn describe(&self) -> String {
        format!(
            "vk-display (VK_KHR_display plane {}, {:?}, FIFO)",
            self.plane, self.config.format
        )
    }
    fn ready(&self) -> bool {
        !self.paused
    }

    fn frame(&mut self, draw: &mut dyn FnMut(&wgpu::TextureView) -> bool) -> Result<(), String> {
        use wgpu::CurrentSurfaceTexture as C;
        match self.surface.get_current_texture() {
            C::Success(frame) | C::Suboptimal(frame) => {
                let view = frame
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                if draw(&view) {
                    self.queue.present(frame);
                    self.presented += 1;
                }
                // Not drawn: dropping the texture discards it, the screen keeps the last frame.
                Ok(())
            }
            C::Timeout | C::Occluded => Ok(()),
            C::Outdated => {
                self.surface.configure(&self.device, &self.config);
                Ok(())
            }
            C::Lost => Err("the DRM surface was lost (another DRM master?)".into()),
            C::Validation => Err("surface validation error".into()),
        }
    }

    fn flip_fd(&self) -> Option<BorrowedFd<'_>> {
        None
    }
    fn flipped(&mut self) {}

    fn pause(&mut self) {
        self.paused = true;
    }

    fn resume(&mut self) -> Result<(), String> {
        // The driver's WSI owns the CRTC: a new swapchain is the only modeset we can ask for.
        // Whether Mesa's display WSI survives losing master in between is a question for #61.
        self.surface.configure(&self.device, &self.config);
        self.paused = false;
        Ok(())
    }

    fn flips(&self) -> u64 {
        self.presented
    }
}
