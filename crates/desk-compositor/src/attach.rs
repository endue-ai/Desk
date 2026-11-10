//! The texture import entry (#52): a frame a surface attached (`specs/surface/v0` `attach`) becomes
//! the texture its surface nodes sample. The compositor knows surfaces, not engines: a web surface's
//! host and a native plugin attach frames the same way.
//!
//! - `after-copy` (an engine's paint callback, whose texture is valid only until it returns): the
//!   damage is copied into a texture of the surface's own, kept across frames, and the GPU copy is
//!   waited for before `attach` returns, so the producer may reuse its texture at once. A first frame,
//!   or one of a new size or format, is copied whole.
//! - `when-replaced` (zero-copy): the attached texture itself is sampled until a later frame replaces
//!   it, and the replaced frame is released then.
//!
//! The texture reaches this device in one of two ways ([`Source`]): the compositor imports the handle
//! the attach names (an IOSurface by its id in the same process, macOS), once per texture id and
//! generation; or the host imported it already on this device with the engine's own importer.

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::fmt;

use desk_surface::generated::{
    SurfaceAttach, SurfaceFormat, SurfacePixelRect, SurfaceReleaseWhen, SurfaceTextureHandle,
};

use crate::compositor::Compositor;
use crate::types::TextureId;

#[cfg(target_os = "macos")]
pub mod iosurface;

/// Where the texture of an attached frame comes from.
pub enum Source<'a> {
    /// Import the handle the attach names. Supported for `iosurface` handles in the same process on
    /// macOS; other handles need the host's import ([`Source::Imported`]) until #61.
    Handle,
    /// The host imported the handle on this compositor's device already; it matches the attach's
    /// size and format.
    Imported(&'a wgpu::Texture),
}

/// What one [`Frames::attach`] did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Attached {
    /// Frames the surface may write again now, in frame order: the protocol's `release`s.
    pub released: Vec<u64>,
    /// Texture pixels copied into the surface's own texture (`after-copy`); 0 when sampled as is.
    pub copied_px: u64,
    /// The size of the texture the surface's nodes sample now.
    pub size: (u32, u32),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachError {
    /// The attach's texture does not match the texture that holds it (size or format).
    Mismatch(String),
    /// This compositor cannot import that kind of handle.
    Unsupported(&'static str),
    /// The OS refused the handle (gone, or from a process this one cannot read).
    Import(String),
    /// The copy did not finish.
    Wait(String),
}

impl fmt::Display for AttachError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AttachError::Mismatch(why) => write!(f, "the frame does not match its texture: {why}"),
            AttachError::Unsupported(what) => write!(f, "cannot import {what}"),
            AttachError::Import(why) => write!(f, "the texture did not import: {why}"),
            AttachError::Wait(why) => write!(f, "the copy did not finish: {why}"),
        }
    }
}

impl std::error::Error for AttachError {}

/// One surface's frames: its own texture for copies, its imports, the frame it samples.
#[derive(Default)]
struct Held {
    own: Option<wgpu::Texture>,
    /// Imported textures by the producer's texture id and generation.
    imports: HashMap<(u64, u64), wgpu::Texture>,
    /// The `when-replaced` frame on screen, released when the next one comes.
    sampled: Option<u64>,
    size: (u32, u32),
}

/// The frames every surface attached, beside the [`Compositor`] that draws them.
#[derive(Default)]
pub struct Frames {
    held: HashMap<TextureId, Held>,
}

/// The wgpu format of a protocol format.
pub fn wgpu_format(format: SurfaceFormat) -> wgpu::TextureFormat {
    match format {
        SurfaceFormat::Bgra8 => wgpu::TextureFormat::Bgra8Unorm,
        SurfaceFormat::Rgba8 => wgpu::TextureFormat::Rgba8Unorm,
    }
}

impl Frames {
    pub fn new() -> Frames {
        Frames::default()
    }

    /// Take the frame `attach` describes for the surface drawn as `id`, from `source`.
    pub fn attach(
        &mut self,
        compositor: &mut Compositor,
        id: TextureId,
        attach: &SurfaceAttach,
        source: Source<'_>,
    ) -> Result<Attached, AttachError> {
        let texture = &attach.texture;
        let size = (texture.width as u32, texture.height as u32);
        let format = wgpu_format(texture.format);
        let held = self.held.entry(id).or_default();
        // Imports belong to one generation of one texture id: a resize makes a new generation.
        held.imports
            .retain(|(tid, generation), _| *tid != texture.id || *generation == texture.generation);
        let imported;
        let source = match source {
            Source::Imported(source) => source,
            Source::Handle => {
                let key = (texture.id, texture.generation);
                imported = match held.imports.entry(key) {
                    Entry::Occupied(known) => known.get().clone(),
                    Entry::Vacant(new) => new
                        .insert(import(compositor.device(), &texture.handle, size, format)?)
                        .clone(),
                };
                &imported
            }
        };
        if (source.width(), source.height()) != size || source.format() != format {
            return Err(AttachError::Mismatch(format!(
                "{}x{} {:?} attached, {}x{} {:?} given",
                size.0,
                size.1,
                format,
                source.width(),
                source.height(),
                source.format()
            )));
        }
        let mut released = Vec::new();
        let copied_px = match attach.release {
            SurfaceReleaseWhen::AfterCopy => {
                released.extend(held.sampled.take());
                let fresh = !held.own.as_ref().is_some_and(|own| {
                    (own.width(), own.height()) == size && own.format() == format
                });
                if fresh {
                    held.own = Some(own_texture(compositor.device(), size, format));
                }
                let own = held
                    .own
                    .clone()
                    .ok_or(AttachError::Wait("no texture".into()))?;
                let regions = if fresh {
                    vec![whole(size)]
                } else {
                    clamp(&attach.damage, size)
                };
                let copied = copy(compositor, source, &own, &regions)?;
                compositor.update_texture(id, &own);
                released.push(attach.frame);
                copied
            }
            SurfaceReleaseWhen::WhenReplaced => {
                held.own = None;
                released.extend(held.sampled.replace(attach.frame));
                compositor.update_texture(id, source);
                0
            }
        };
        held.size = size;
        Ok(Attached {
            released,
            copied_px,
            size,
        })
    }

    /// The surface's process ended (it sleeps or died): its imports go, its last frame stays drawn.
    /// A sampled `when-replaced` frame stays too; its release never comes (`lifecycle.md`).
    pub fn ended(&mut self, id: TextureId) {
        if let Some(held) = self.held.get_mut(&id) {
            held.imports.clear();
            held.sampled = None;
        }
    }

    /// The surface is destroyed: everything of it goes, and its nodes stop drawing.
    pub fn destroy(&mut self, compositor: &mut Compositor, id: TextureId) {
        self.held.remove(&id);
        compositor.remove_texture(id);
    }

    /// The size of the texture `id`'s nodes sample, once a frame came.
    pub fn size(&self, id: TextureId) -> Option<(u32, u32)> {
        self.held.get(&id).map(|held| held.size)
    }

    /// How many textures of `id` are imported (one per texture id and generation in use).
    pub fn imports(&self, id: TextureId) -> usize {
        self.held.get(&id).map_or(0, |held| held.imports.len())
    }
}

fn whole(size: (u32, u32)) -> SurfacePixelRect {
    SurfacePixelRect {
        x: 0,
        y: 0,
        width: u64::from(size.0),
        height: u64::from(size.1),
    }
}

/// The damage inside the texture; none listed means all of it changed.
fn clamp(damage: &[SurfacePixelRect], size: (u32, u32)) -> Vec<SurfacePixelRect> {
    let (w, h) = (u64::from(size.0), u64::from(size.1));
    let inside: Vec<_> = damage
        .iter()
        .filter(|r| r.x < w && r.y < h)
        .map(|r| SurfacePixelRect {
            x: r.x,
            y: r.y,
            width: r.width.min(w - r.x),
            height: r.height.min(h - r.y),
        })
        .filter(|r| r.width > 0 && r.height > 0)
        .collect();
    if damage.is_empty() {
        vec![whole(size)]
    } else {
        inside
    }
}

fn own_texture(
    device: &wgpu::Device,
    size: (u32, u32),
    format: wgpu::TextureFormat,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("desk-compositor surface frame"),
        size: wgpu::Extent3d {
            width: size.0.max(1),
            height: size.1.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_DST
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

/// Copy `regions` of `source` into `own` and wait for the GPU: the producer reuses its texture next.
fn copy(
    compositor: &Compositor,
    source: &wgpu::Texture,
    own: &wgpu::Texture,
    regions: &[SurfacePixelRect],
) -> Result<u64, AttachError> {
    if regions.is_empty() {
        return Ok(0);
    }
    let device = compositor.device();
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("desk-compositor attach"),
    });
    let mut copied = 0;
    for r in regions {
        let origin = wgpu::Origin3d {
            x: r.x as u32,
            y: r.y as u32,
            z: 0,
        };
        let at = |texture| wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: 0,
            origin,
            aspect: wgpu::TextureAspect::All,
        };
        let extent = wgpu::Extent3d {
            width: r.width as u32,
            height: r.height as u32,
            depth_or_array_layers: 1,
        };
        encoder.copy_texture_to_texture(at(source), at(own), extent);
        copied += r.width * r.height;
    }
    let submission = compositor.queue().submit([encoder.finish()]);
    device
        .poll(wgpu::PollType::Wait {
            submission_index: Some(submission),
            timeout: None,
        })
        .map_err(|e| AttachError::Wait(e.to_string()))?;
    Ok(copied)
}

/// Import `handle` on `device`, where this compositor can.
fn import(
    device: &wgpu::Device,
    handle: &SurfaceTextureHandle,
    size: (u32, u32),
    format: wgpu::TextureFormat,
) -> Result<wgpu::Texture, AttachError> {
    match handle {
        #[cfg(target_os = "macos")]
        SurfaceTextureHandle::SurfaceIoSurface(h) if h.port_index.is_none() => {
            iosurface::import_by_id(device, h.id, size, format)
        }
        SurfaceTextureHandle::SurfaceIoSurface(_) => {
            let _ = (device, size, format);
            Err(AttachError::Unsupported(
                "an IOSurface from another process or OS",
            ))
        }
        SurfaceTextureHandle::SurfaceD3d11(_) => Err(AttachError::Unsupported(
            "a D3D11 handle (the host imports it, #61)",
        )),
        SurfaceTextureHandle::SurfaceDmaBuf(_) => Err(AttachError::Unsupported(
            "a DMA-BUF (the host imports it, #61)",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{SurfacePixelRect, clamp, whole};

    fn rect(x: u64, y: u64, width: u64, height: u64) -> SurfacePixelRect {
        SurfacePixelRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn damage_is_kept_inside_the_texture_and_none_means_all() {
        assert_eq!(clamp(&[], (8, 4)), vec![whole((8, 4))]);
        assert_eq!(
            clamp(&[rect(6, 2, 10, 10), rect(9, 0, 1, 1)], (8, 4)),
            vec![rect(6, 2, 2, 2)]
        );
        assert_eq!(clamp(&[rect(0, 0, 0, 3)], (8, 4)), vec![]);
    }
}
