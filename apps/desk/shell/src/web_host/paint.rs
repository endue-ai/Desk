//! An engine paint as the protocol's `attach` (`specs/surface/v0/texture.md`): the shared texture's
//! handle, size and format, and its damage in texture pixels. CEF's shared texture is valid only
//! while its paint callback runs, so macOS frames are `after-copy`; on Windows and Linux the `cef`
//! crate's importer already copied it into a texture of the compositor's device, which is sampled
//! until the next frame replaces it (`when-replaced`).

use cef::{AcceleratedPaintInfo, ColorType, Rect};
use desk_surface::generated::{
    SurfaceAttach, SurfaceAttachType, SurfaceFormat, SurfacePixelRect, SurfaceReleaseWhen,
    SurfaceTexture, SurfaceTextureHandle,
};

/// The most damage rectangles one frame lists (`texture.md`); more become their bounding box.
const MOST_DAMAGE: usize = 32;

/// A shared texture CEF painted, as the protocol names it.
pub struct Painted {
    /// The producer's name for the texture: the IOSurfaceID, the handle's value, the first fd.
    pub id: u64,
    pub size: (u32, u32),
    pub format: SurfaceFormat,
    pub handle: SurfaceTextureHandle,
    pub release: SurfaceReleaseWhen,
}

/// The protocol format of CEF's colour type.
pub fn format_of(color: &ColorType) -> SurfaceFormat {
    if *color == ColorType::RGBA_8888 {
        SurfaceFormat::Rgba8
    } else {
        SurfaceFormat::Bgra8
    }
}

/// The damage of a `size`-pixel texture from CEF's dirty rectangles (pixels), inside the texture;
/// none, or a whole-texture one, is one rectangle covering it.
pub fn damage(dirty: Option<&[Rect]>, size: (u32, u32)) -> Vec<SurfacePixelRect> {
    let (w, h) = (i64::from(size.0), i64::from(size.1));
    let mut rects: Vec<SurfacePixelRect> = dirty
        .unwrap_or_default()
        .iter()
        .filter_map(|r| {
            let (x0, y0) = (i64::from(r.x).clamp(0, w), i64::from(r.y).clamp(0, h));
            let x1 = (i64::from(r.x) + i64::from(r.width)).clamp(0, w);
            let y1 = (i64::from(r.y) + i64::from(r.height)).clamp(0, h);
            (x1 > x0 && y1 > y0).then(|| pixel_rect(x0, y0, x1 - x0, y1 - y0))
        })
        .collect();
    if rects.len() > MOST_DAMAGE {
        let x0 = rects.iter().map(|r| r.x).min().unwrap_or(0);
        let y0 = rects.iter().map(|r| r.y).min().unwrap_or(0);
        let x1 = rects.iter().map(|r| r.x + r.width).max().unwrap_or(0);
        let y1 = rects.iter().map(|r| r.y + r.height).max().unwrap_or(0);
        rects = vec![pixel_rect(
            x0 as i64,
            y0 as i64,
            (x1 - x0) as i64,
            (y1 - y0) as i64,
        )];
    }
    if rects.is_empty() {
        rects.push(pixel_rect(0, 0, w, h));
    }
    rects
}

fn pixel_rect(x: i64, y: i64, width: i64, height: i64) -> SurfacePixelRect {
    SurfacePixelRect {
        x: x as u64,
        y: y as u64,
        width: width as u64,
        height: height as u64,
    }
}

/// The attach of frame `frame` (generation `generation`) of `surface`.
pub fn attach(
    surface: &str,
    frame: u64,
    generation: u64,
    painted: &Painted,
    damage: Vec<SurfacePixelRect>,
) -> SurfaceAttach {
    SurfaceAttach {
        r#type: SurfaceAttachType::Attach,
        surface: surface.to_owned(),
        frame,
        texture: SurfaceTexture {
            id: painted.id,
            generation,
            width: u64::from(painted.size.0),
            height: u64::from(painted.size.1),
            format: painted.format,
            handle: painted.handle.clone(),
        },
        damage,
        release: painted.release,
        fence_fd_index: None,
    }
}

/// The handle of a software paint the host uploaded itself: this OS's kind, naming no shared texture
/// (id 0, no fd). The compositor never reads it: the attach comes with the uploaded texture.
pub fn software_handle() -> SurfaceTextureHandle {
    #[cfg(target_os = "macos")]
    {
        use desk_surface::generated::{SurfaceIoSurfaceHandle, SurfaceIoSurfaceHandleKind};
        SurfaceTextureHandle::SurfaceIoSurface(SurfaceIoSurfaceHandle {
            kind: SurfaceIoSurfaceHandleKind::Iosurface,
            id: 0,
            port_index: None,
        })
    }
    #[cfg(target_os = "windows")]
    {
        use desk_surface::generated::{SurfaceD3d11Handle, SurfaceD3d11HandleKind};
        SurfaceTextureHandle::SurfaceD3d11(SurfaceD3d11Handle {
            kind: SurfaceD3d11HandleKind::D3d11,
            handle: 0,
            keyed_mutex: false,
        })
    }
    #[cfg(target_os = "linux")]
    {
        use desk_surface::generated::{SurfaceDmaBufHandle, SurfaceDmaBufHandleKind};
        SurfaceTextureHandle::SurfaceDmaBuf(SurfaceDmaBufHandle {
            kind: SurfaceDmaBufHandleKind::Dmabuf,
            fourcc: "AR24".to_owned(),
            modifier: "0x0".to_owned(),
            planes: Vec::new(),
        })
    }
}

/// The size CEF says the shared texture has.
fn coded_size(info: &AcceleratedPaintInfo) -> (u32, u32) {
    let size = &info.extra.coded_size;
    (size.width.max(0) as u32, size.height.max(0) as u32)
}

/// macOS: the IOSurface, named by its IOSurfaceID; the compositor imports it in this process.
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
pub fn painted(info: &AcceleratedPaintInfo) -> Option<Painted> {
    use desk_surface::generated::{SurfaceIoSurfaceHandle, SurfaceIoSurfaceHandleKind};
    let surface = std::ptr::NonNull::new(info.shared_texture_io_surface)?;
    // SAFETY: inside the paint callback CEF holds the IOSurface its info names.
    let id = unsafe { surface.cast::<objc2_io_surface::IOSurfaceRef>().as_ref() }.id();
    Some(Painted {
        id: u64::from(id),
        size: coded_size(info),
        format: format_of(&info.format),
        handle: SurfaceTextureHandle::SurfaceIoSurface(SurfaceIoSurfaceHandle {
            kind: SurfaceIoSurfaceHandleKind::Iosurface,
            id: u64::from(id),
            port_index: None,
        }),
        release: SurfaceReleaseWhen::AfterCopy,
    })
}

/// Windows: the D3D11 shared handle (no keyed mutex: CEF waits for its GPU before the callback).
#[cfg(target_os = "windows")]
pub fn painted(info: &AcceleratedPaintInfo) -> Option<Painted> {
    use desk_surface::generated::{SurfaceD3d11Handle, SurfaceD3d11HandleKind};
    let handle = info.shared_texture_handle as usize as u64;
    (handle != 0).then(|| Painted {
        id: handle,
        size: coded_size(info),
        format: format_of(&info.format),
        handle: SurfaceTextureHandle::SurfaceD3d11(SurfaceD3d11Handle {
            kind: SurfaceD3d11HandleKind::D3d11,
            handle,
            keyed_mutex: false,
        }),
        release: SurfaceReleaseWhen::WhenReplaced,
    })
}

/// Linux: the DMA-BUF's planes and modifier; the fds stay CEF's, named by their order.
#[cfg(target_os = "linux")]
pub fn painted(info: &AcceleratedPaintInfo) -> Option<Painted> {
    use desk_surface::generated::{
        SurfaceDmaBufHandle, SurfaceDmaBufHandleKind, SurfaceDmaBufPlane,
    };
    let count = info.plane_count.clamp(0, 4) as usize;
    let planes: Vec<SurfaceDmaBufPlane> = info.planes[..count]
        .iter()
        .enumerate()
        .map(|(i, p)| SurfaceDmaBufPlane {
            fd_index: i as u64,
            stride: u64::from(p.stride),
            offset: p.offset,
        })
        .collect();
    let first = info.planes.first().map(|p| p.fd).unwrap_or(-1);
    let format = format_of(&info.format);
    let fourcc = if format == SurfaceFormat::Rgba8 {
        "AB24"
    } else {
        "AR24"
    };
    (count > 0 && first >= 0).then(|| Painted {
        id: first as u64,
        size: coded_size(info),
        format,
        handle: SurfaceTextureHandle::SurfaceDmaBuf(SurfaceDmaBufHandle {
            kind: SurfaceDmaBufHandleKind::Dmabuf,
            fourcc: fourcc.to_owned(),
            modifier: format!("{:#x}", info.modifier),
            planes,
        }),
        release: SurfaceReleaseWhen::WhenReplaced,
    })
}

#[cfg(test)]
mod tests {
    use super::damage;
    use cef::Rect;
    use desk_surface::generated::SurfacePixelRect;

    fn r(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn p(x: u64, y: u64, width: u64, height: u64) -> SurfacePixelRect {
        SurfacePixelRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn damage_stays_inside_the_texture_and_none_is_all_of_it() {
        assert_eq!(damage(None, (100, 50)), vec![p(0, 0, 100, 50)]);
        assert_eq!(
            damage(Some(&[r(90, 40, 20, 20), r(-5, 0, 10, 10)]), (100, 50)),
            vec![p(90, 40, 10, 10), p(0, 0, 5, 10)]
        );
        assert_eq!(
            damage(Some(&[r(200, 0, 5, 5)]), (100, 50)),
            vec![p(0, 0, 100, 50)]
        );
    }

    #[test]
    fn more_than_thirty_two_rectangles_become_their_bounding_box() {
        let many: Vec<Rect> = (0..40).map(|i| r(i, i, 1, 1)).collect();
        assert_eq!(damage(Some(&many), (100, 50)), vec![p(0, 0, 40, 40)]);
    }
}
