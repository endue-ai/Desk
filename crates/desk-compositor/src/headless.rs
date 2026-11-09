//! Rendering without a window: a device from whatever adapter the machine has (a software one on
//! CI), an off-screen target, readback to RGBA and texture upload for tests, demos and benchmarks.

use std::fmt;

/// A device and queue on an adapter that needs no window.
pub struct Headless {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter: wgpu::AdapterInfo,
}

#[derive(Debug)]
pub enum HeadlessError {
    /// No adapter at all: no GPU driver and no software rasteriser (lavapipe, WARP) installed.
    NoAdapter(String),
    Device(String),
    Readback(String),
}

impl fmt::Display for HeadlessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HeadlessError::NoAdapter(why) => write!(f, "no GPU adapter: {why}"),
            HeadlessError::Device(why) => write!(f, "no GPU device: {why}"),
            HeadlessError::Readback(why) => write!(f, "readback failed: {why}"),
        }
    }
}

impl std::error::Error for HeadlessError {}

/// A device on the machine's adapter, or on its software fallback when there is no GPU (WARP on
/// Windows, lavapipe on Linux). Backends are Metal, DX12 and Vulkan unless `WGPU_BACKEND` names
/// others (`gl` for llvmpipe through EGL).
pub fn headless_device() -> Result<Headless, HeadlessError> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY),
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let request = |force_fallback_adapter| {
        pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            force_fallback_adapter,
            ..Default::default()
        }))
    };
    let adapter = request(false)
        .or_else(|_| request(true))
        .map_err(|e| HeadlessError::NoAdapter(e.to_string()))?;
    let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("desk-compositor headless"),
        required_limits: limits,
        ..Default::default()
    }))
    .map_err(|e| HeadlessError::Device(e.to_string()))?;
    Ok(Headless {
        device,
        queue,
        adapter: adapter.get_info(),
    })
}

/// An off-screen texture to render into and read back.
pub struct Target {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub size: (u32, u32),
}

impl Target {
    pub fn new(device: &wgpu::Device, size: (u32, u32), format: wgpu::TextureFormat) -> Target {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("desk-compositor target"),
            size: extent(size),
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Target {
            texture,
            view,
            size,
        }
    }

    /// The target's pixels as tightly packed RGBA8 rows, top row first. Waits for the GPU.
    pub fn read_rgba(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<Vec<u8>, HeadlessError> {
        let swap = match self.texture.format() {
            wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Rgba8UnormSrgb => false,
            wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb => true,
            other => return Err(HeadlessError::Readback(format!("format {other:?}"))),
        };
        let (w, h) = self.size;
        let padded = (w * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("desk-compositor readback"),
            size: u64::from(padded * h),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("desk-compositor readback"),
        });
        encoder.copy_texture_to_buffer(
            self.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(h),
                },
            },
            extent(self.size),
        );
        queue.submit([encoder.finish()]);
        let slice = buffer.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| HeadlessError::Readback(e.to_string()))?;
        let data = slice
            .get_mapped_range()
            .map_err(|e| HeadlessError::Readback(format!("{e:?}")))?;
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for row in data.chunks_exact(padded as usize).take(h as usize) {
            let (pixels, _) = row[..(w * 4) as usize].as_chunks::<4>();
            for &[a, b, c, alpha] in pixels {
                let px = if swap {
                    [c, b, a, alpha]
                } else {
                    [a, b, c, alpha]
                };
                rgba.extend_from_slice(&px);
            }
        }
        drop(data);
        buffer.unmap();
        Ok(rgba)
    }
}

/// A texture holding `rgba` (tightly packed RGBA8 rows, premultiplied), ready to register.
pub fn upload_rgba(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    size: (u32, u32),
    rgba: &[u8],
) -> wgpu::Texture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("desk-compositor upload"),
        size: extent(size),
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    queue.write_texture(
        texture.as_image_copy(),
        rgba,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size.0 * 4),
            rows_per_image: Some(size.1),
        },
        extent(size),
    );
    texture
}

fn extent(size: (u32, u32)) -> wgpu::Extent3d {
    wgpu::Extent3d {
        width: size.0.max(1),
        height: size.1.max(1),
        depth_or_array_layers: 1,
    }
}
