//! macOS: a native plugin's frame as an IOSurface it renders into with wgpu. The IOSurface is the
//! process's own; its Mach send right goes to the desk with the first frame that names it
//! (`Plugin::attach`), and the desk's compositor reads the same memory: frames never leave the GPU.
#![allow(unsafe_code)]

use objc2_core_foundation::CFRetained;
use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};

use super::mach::bgra_surface;

/// The format of every frame: BGRA, 8 bits a channel, what the compositor composites natively.
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;

/// An IOSurface and the wgpu texture over it.
pub struct SharedTexture {
    surface: CFRetained<IOSurfaceRef>,
    texture: wgpu::Texture,
    size: (u32, u32),
}

impl SharedTexture {
    /// A `size` frame on `device`, which must be wgpu's Metal device: a render target and a copy
    /// destination.
    pub fn new(device: &wgpu::Device, size: (u32, u32)) -> Result<SharedTexture, String> {
        let limit = device.limits().max_texture_dimension_2d;
        if size.0 == 0 || size.1 == 0 || size.0 > limit || size.1 > limit {
            return Err(format!("{}x{} is outside 1..={limit}", size.0, size.1));
        }
        let surface = bgra_surface(size.0, size.1).ok_or("the OS made no IOSurface")?;
        let metal = MTLTextureDescriptor::new();
        // SAFETY: plain property setters on a descriptor this function owns.
        unsafe {
            metal.setWidth(size.0 as usize);
            metal.setHeight(size.1 as usize);
            metal.setTextureType(MTLTextureType::Type2D);
            metal.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
            metal.setUsage(MTLTextureUsage::RenderTarget | MTLTextureUsage::ShaderRead);
            metal.setStorageMode(MTLStorageMode::Managed);
        }
        let desc = wgpu::TextureDescriptor {
            label: Some("desk-surface native frame"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        };
        // SAFETY: the device is wgpu's own Metal device; the texture lives as long as wgpu keeps it,
        // and wraps an IOSurface of exactly `size` in BGRA that this value keeps alive.
        let hal = unsafe {
            let hal_device = device
                .as_hal::<wgpu::wgc::api::Metal>()
                .ok_or("frames need wgpu's Metal backend")?;
            let raw = hal_device
                .raw_device()
                .newTextureWithDescriptor_iosurface_plane(&metal, &surface, 0)
                .ok_or("Metal refused the IOSurface")?;
            <wgpu::wgc::api::Metal as wgpu::hal::Api>::Device::texture_from_raw(
                raw,
                FORMAT,
                MTLTextureType::Type2D,
                1,
                1,
                wgpu::hal::CopyExtent {
                    width: size.0,
                    height: size.1,
                    depth: 1,
                },
                None,
            )
        };
        // SAFETY: `hal` was made on `device` with `desc`'s size, format and usage.
        let texture = unsafe {
            device.create_texture_from_hal::<wgpu::wgc::api::Metal>(
                hal,
                &desc,
                wgpu::TextureUses::COLOR_TARGET,
            )
        };
        Ok(SharedTexture {
            surface,
            texture,
            size,
        })
    }

    /// The texture to render into.
    pub fn texture(&self) -> &wgpu::Texture {
        &self.texture
    }

    /// The IOSurface underneath, whose right goes to the desk.
    pub fn surface(&self) -> &IOSurfaceRef {
        &self.surface
    }

    /// Its IOSurfaceID, which the frame's handle names.
    pub fn id(&self) -> u32 {
        self.surface.id()
    }

    /// Its size in pixels.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }
}
