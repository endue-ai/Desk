//! macOS: an IOSurface as a wgpu texture on a Metal device, without a copy. In the desk's own process
//! the protocol's `iosurface` handle names the surface by its IOSurfaceID (`IOSurfaceLookup`); across
//! processes its Mach send right comes instead (#59). The wrapper retains the IOSurface while the
//! compositor keeps the import.
#![allow(unsafe_code)]

use objc2_io_surface::IOSurfaceRef;
use objc2_metal::{
    MTLDevice, MTLPixelFormat, MTLStorageMode, MTLTextureDescriptor, MTLTextureType,
    MTLTextureUsage,
};

use super::AttachError;

/// Import the IOSurface with `id`, which this process holds, as a `width` x `height` texture.
pub fn import_by_id(
    device: &wgpu::Device,
    id: u64,
    size: (u32, u32),
    format: wgpu::TextureFormat,
) -> Result<wgpu::Texture, AttachError> {
    let id = u32::try_from(id).map_err(|_| AttachError::Import(format!("IOSurface id {id}")))?;
    let surface = IOSurfaceRef::lookup(id)
        .ok_or_else(|| AttachError::Import(format!("no IOSurface {id} in this process")))?;
    // SAFETY: `surface` is a live IOSurface this function holds a reference to.
    unsafe { wrap(device, &surface, size, format) }
}

/// Wrap `surface` as a texture of `size` and `format` on `device` (Metal), usable as a copy source.
///
/// # Safety
///
/// `surface` must be a live IOSurface of at least `size` pixels in `format`'s layout.
pub unsafe fn wrap(
    device: &wgpu::Device,
    surface: &IOSurfaceRef,
    size: (u32, u32),
    format: wgpu::TextureFormat,
) -> Result<wgpu::Texture, AttachError> {
    let pixel_format = match format {
        wgpu::TextureFormat::Bgra8Unorm => MTLPixelFormat::BGRA8Unorm,
        wgpu::TextureFormat::Rgba8Unorm => MTLPixelFormat::RGBA8Unorm,
        _ => return Err(AttachError::Unsupported("that pixel format")),
    };
    let limit = device.limits().max_texture_dimension_2d;
    if size.0 == 0 || size.1 == 0 || size.0 > limit || size.1 > limit {
        return Err(AttachError::Mismatch(format!(
            "{}x{} is outside 1..={limit}",
            size.0, size.1
        )));
    }
    if surface.width() < size.0 as usize || surface.height() < size.1 as usize {
        return Err(AttachError::Mismatch(format!(
            "the IOSurface is {}x{}, the frame {}x{}",
            surface.width(),
            surface.height(),
            size.0,
            size.1
        )));
    }
    let desc = wgpu::TextureDescriptor {
        label: Some("desk-compositor IOSurface"),
        size: wgpu::Extent3d {
            width: size.0,
            height: size.1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    };
    let metal = MTLTextureDescriptor::new();
    // SAFETY: plain property setters on a descriptor this function owns.
    unsafe {
        metal.setWidth(size.0 as usize);
        metal.setHeight(size.1 as usize);
        metal.setTextureType(MTLTextureType::Type2D);
        metal.setPixelFormat(pixel_format);
        metal.setUsage(MTLTextureUsage::ShaderRead);
        metal.setStorageMode(MTLStorageMode::Managed);
    }
    // SAFETY: the device is wgpu's own Metal device; the texture lives as long as wgpu keeps it.
    let hal = unsafe {
        let Some(hal_device) = device.as_hal::<wgpu::wgc::api::Metal>() else {
            return Err(AttachError::Unsupported(
                "IOSurfaces on a device that is not Metal",
            ));
        };
        let raw = hal_device
            .raw_device()
            .newTextureWithDescriptor_iosurface_plane(&metal, surface, 0)
            .ok_or_else(|| AttachError::Import("Metal refused the IOSurface".into()))?;
        <wgpu::wgc::api::Metal as wgpu::hal::Api>::Device::texture_from_raw(
            raw,
            format,
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
    Ok(unsafe {
        device.create_texture_from_hal::<wgpu::wgc::api::Metal>(
            hal,
            &desc,
            wgpu::TextureUses::RESOURCE,
        )
    })
}
