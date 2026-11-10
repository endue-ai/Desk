//! The texture import entry (#52) on a real adapter: frames a surface attaches (specs/surface/v0
//! `attach`) reach the texture its node samples. `after-copy` copies the damage into the surface's
//! own texture and releases at once; `when-replaced` samples the frame and releases it when the next
//! one comes. On macOS an IOSurface named by its id is imported once per texture id and generation.

mod support;

use desk_compositor::headless::{Target, upload_rgba};
use desk_compositor::*;
use desk_surface::generated::{
    SurfaceAttach, SurfaceAttachType, SurfaceFormat, SurfaceIoSurfaceHandle,
    SurfaceIoSurfaceHandleKind, SurfacePixelRect, SurfaceReleaseWhen, SurfaceTexture,
    SurfaceTextureHandle,
};
use support::{FORMAT, gpu, near, pixel};

const RED: [u8; 4] = [255, 0, 0, 255];
const GREEN: [u8; 4] = [0, 255, 0, 255];
const SIZE: (u32, u32) = (64, 32);
const SURFACE: TextureId = TextureId(7);

fn rect(x: u64, y: u64, width: u64, height: u64) -> SurfacePixelRect {
    SurfacePixelRect {
        x,
        y,
        width,
        height,
    }
}

/// An attach of `frame`, `size` pixels in `format`, from the IOSurface `handle`.
fn attach(
    frame: u64,
    size: (u32, u32),
    format: SurfaceFormat,
    handle: u64,
    damage: Vec<SurfacePixelRect>,
    release: SurfaceReleaseWhen,
) -> SurfaceAttach {
    SurfaceAttach {
        r#type: SurfaceAttachType::Attach,
        surface: "s-1".into(),
        frame,
        texture: SurfaceTexture {
            id: handle,
            generation: u64::from(size.0) << 32 | u64::from(size.1),
            width: u64::from(size.0),
            height: u64::from(size.1),
            format,
            handle: SurfaceTextureHandle::SurfaceIoSurface(SurfaceIoSurfaceHandle {
                kind: SurfaceIoSurfaceHandleKind::Iosurface,
                id: handle,
                port_index: None,
            }),
        },
        damage,
        release,
        fence_fd_index: None,
    }
}

fn solid(size: (u32, u32), colour: [u8; 4]) -> Vec<u8> {
    colour.repeat((size.0 * size.1) as usize)
}

/// The composed frame with the surface drawn over the whole target.
fn compose(gpu: &headless::Headless, compositor: &mut Compositor, size: (u32, u32)) -> Vec<u8> {
    let mut scene = Scene::new(size.0, size.1);
    let whole = Rect::new(0.0, 0.0, size.0 as f32, size.1 as f32);
    scene
        .insert(scene.root(), SurfaceNode::new(whole, SURFACE))
        .unwrap();
    let target = Target::new(&gpu.device, size, FORMAT);
    compositor.invalidate();
    assert!(compositor.render(&scene, &target.view, size).drawn);
    target.read_rgba(&gpu.device, &gpu.queue).unwrap()
}

#[test]
fn an_after_copy_frame_lands_in_the_surfaces_own_texture_and_only_its_damage_is_copied_again() {
    let Some(gpu) = gpu("after_copy") else { return };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let mut frames = Frames::new();
    let red = upload_rgba(&gpu.device, &gpu.queue, SIZE, &solid(SIZE, RED));
    let first = attach(
        1,
        SIZE,
        SurfaceFormat::Rgba8,
        3,
        vec![rect(0, 0, 1, 1)],
        SurfaceReleaseWhen::AfterCopy,
    );
    let done = frames
        .attach(&mut compositor, SURFACE, &first, Source::Imported(&red))
        .unwrap();
    assert_eq!(done.released, vec![1], "released before it is composed");
    assert_eq!(
        done.copied_px,
        64 * 32,
        "a first frame is copied whole, whatever its damage"
    );
    assert_eq!(frames.size(SURFACE), Some(SIZE));
    let rgba = compose(&gpu, &mut compositor, SIZE);
    assert!(near(pixel(&rgba, 64, 40, 20), RED));

    // The producer reuses its texture: the next frame is green, and only its left half changed.
    let green = upload_rgba(&gpu.device, &gpu.queue, SIZE, &solid(SIZE, GREEN));
    let second = attach(
        2,
        SIZE,
        SurfaceFormat::Rgba8,
        3,
        vec![rect(0, 0, 32, 32)],
        SurfaceReleaseWhen::AfterCopy,
    );
    let done = frames
        .attach(&mut compositor, SURFACE, &second, Source::Imported(&green))
        .unwrap();
    assert_eq!((done.released, done.copied_px), (vec![2], 32 * 32));
    let rgba = compose(&gpu, &mut compositor, SIZE);
    assert!(
        near(pixel(&rgba, 64, 4, 20), GREEN),
        "the damage was copied"
    );
    assert!(
        near(pixel(&rgba, 64, 60, 20), RED),
        "the rest is the last frame's"
    );

    // A new size is a new texture: copied whole.
    let wide = (80, 32);
    let bigger = upload_rgba(&gpu.device, &gpu.queue, wide, &solid(wide, GREEN));
    let third = attach(
        3,
        wide,
        SurfaceFormat::Rgba8,
        3,
        vec![rect(0, 0, 1, 1)],
        SurfaceReleaseWhen::AfterCopy,
    );
    let done = frames
        .attach(&mut compositor, SURFACE, &third, Source::Imported(&bigger))
        .unwrap();
    assert_eq!((done.copied_px, done.size), (80 * 32, wide));
}

#[test]
fn a_when_replaced_frame_is_sampled_as_is_and_released_by_the_next() {
    let Some(gpu) = gpu("when_replaced") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let mut frames = Frames::new();
    let red = upload_rgba(&gpu.device, &gpu.queue, SIZE, &solid(SIZE, RED));
    let green = upload_rgba(&gpu.device, &gpu.queue, SIZE, &solid(SIZE, GREEN));
    let first = attach(
        4,
        SIZE,
        SurfaceFormat::Rgba8,
        1,
        vec![],
        SurfaceReleaseWhen::WhenReplaced,
    );
    let done = frames
        .attach(&mut compositor, SURFACE, &first, Source::Imported(&red))
        .unwrap();
    assert_eq!((done.released, done.copied_px), (vec![], 0));
    assert!(near(
        pixel(&compose(&gpu, &mut compositor, SIZE), 64, 9, 9),
        RED
    ));
    let second = attach(
        5,
        SIZE,
        SurfaceFormat::Rgba8,
        2,
        vec![],
        SurfaceReleaseWhen::WhenReplaced,
    );
    let done = frames
        .attach(&mut compositor, SURFACE, &second, Source::Imported(&green))
        .unwrap();
    assert_eq!(done.released, vec![4], "the replaced frame goes back");
    assert!(near(
        pixel(&compose(&gpu, &mut compositor, SIZE), 64, 9, 9),
        GREEN
    ));
}

#[test]
fn a_frame_that_does_not_match_its_texture_is_refused_and_destroy_stops_the_drawing() {
    let Some(gpu) = gpu("mismatch") else { return };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let mut frames = Frames::new();
    let red = upload_rgba(&gpu.device, &gpu.queue, SIZE, &solid(SIZE, RED));
    let wrong_size = attach(
        1,
        (10, 10),
        SurfaceFormat::Rgba8,
        1,
        vec![],
        SurfaceReleaseWhen::AfterCopy,
    );
    let refused = frames.attach(
        &mut compositor,
        SURFACE,
        &wrong_size,
        Source::Imported(&red),
    );
    assert!(
        matches!(refused, Err(AttachError::Mismatch(_))),
        "{refused:?}"
    );
    let wrong_format = attach(
        1,
        SIZE,
        SurfaceFormat::Bgra8,
        1,
        vec![],
        SurfaceReleaseWhen::AfterCopy,
    );
    let refused = frames.attach(
        &mut compositor,
        SURFACE,
        &wrong_format,
        Source::Imported(&red),
    );
    assert!(
        matches!(refused, Err(AttachError::Mismatch(_))),
        "{refused:?}"
    );
    let fine = attach(
        2,
        SIZE,
        SurfaceFormat::Rgba8,
        1,
        vec![],
        SurfaceReleaseWhen::AfterCopy,
    );
    frames
        .attach(&mut compositor, SURFACE, &fine, Source::Imported(&red))
        .unwrap();
    assert_eq!(compositor.textures_resident(), 1);
    frames.destroy(&mut compositor, SURFACE);
    assert_eq!(
        (compositor.textures_resident(), frames.size(SURFACE)),
        (0, None)
    );
}

#[cfg(not(target_os = "macos"))]
#[test]
fn a_handle_this_compositor_cannot_import_is_refused() {
    let Some(gpu) = gpu("unsupported") else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    let frame = attach(
        1,
        SIZE,
        SurfaceFormat::Bgra8,
        1,
        vec![],
        SurfaceReleaseWhen::AfterCopy,
    );
    let refused = Frames::new().attach(&mut compositor, SURFACE, &frame, Source::Handle);
    assert!(
        matches!(refused, Err(AttachError::Unsupported(_))),
        "{refused:?}"
    );
}

#[cfg(target_os = "macos")]
mod iosurface {
    use super::*;
    use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString};
    use objc2_io_surface::{
        IOSurfaceLockOptions, IOSurfaceRef, kIOSurfaceBytesPerElement, kIOSurfaceHeight,
        kIOSurfacePixelFormat, kIOSurfaceWidth,
    };

    /// A BGRA IOSurface of `size` filled with `rgba`, as a GPU process would hand one over.
    #[allow(unsafe_code)]
    fn surface(size: (u32, u32), rgba: [u8; 4]) -> CFRetained<IOSurfaceRef> {
        // SAFETY: the keys are IOSurface's own constants; the values are CFNumbers.
        let keys: [&CFString; 4] = unsafe {
            [
                kIOSurfaceWidth,
                kIOSurfaceHeight,
                kIOSurfaceBytesPerElement,
                kIOSurfacePixelFormat,
            ]
        };
        let bgra = u32::from_be_bytes(*b"BGRA") as i32;
        let values = [
            CFNumber::new_i32(size.0 as i32),
            CFNumber::new_i32(size.1 as i32),
            CFNumber::new_i32(4),
            CFNumber::new_i32(bgra),
        ];
        let values: Vec<&CFNumber> = values.iter().map(|v| &**v).collect();
        let properties = CFDictionary::<CFString, CFNumber>::from_slices(&keys, &values);
        // SAFETY: a dictionary of IOSurface creation properties.
        let surface = unsafe { IOSurfaceRef::new(properties.as_opaque()) }.expect("an IOSurface");
        // SAFETY: locked for writing, written within its rows, unlocked.
        unsafe {
            surface.lock(IOSurfaceLockOptions::empty(), std::ptr::null_mut());
            let row = surface.bytes_per_row();
            let base = surface.base_address().as_ptr().cast::<u8>();
            let [r, g, b, a] = rgba;
            for y in 0..size.1 as usize {
                for x in 0..size.0 as usize {
                    let at = base.add(y * row + x * 4);
                    std::ptr::copy_nonoverlapping([b, g, r, a].as_ptr(), at, 4);
                }
            }
            surface.unlock(IOSurfaceLockOptions::empty(), std::ptr::null_mut());
        }
        surface
    }

    #[test]
    fn an_iosurface_named_by_its_id_is_imported_once_per_generation_and_composed() {
        let Some(gpu) = gpu("iosurface") else { return };
        if gpu.adapter.backend != wgpu::Backend::Metal {
            eprintln!(
                "iosurface: skipped, the adapter is {:?}",
                gpu.adapter.backend
            );
            return;
        }
        let blue = [0, 0, 255, 255];
        let held = surface(SIZE, blue);
        let id = u64::from(held.id());
        let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
        let mut frames = Frames::new();
        for frame in 1..=3 {
            let damage = vec![rect(0, 0, 64, 32)];
            let next = attach(
                frame,
                SIZE,
                SurfaceFormat::Bgra8,
                id,
                damage,
                SurfaceReleaseWhen::AfterCopy,
            );
            let done = frames
                .attach(&mut compositor, SURFACE, &next, Source::Handle)
                .unwrap();
            assert_eq!(done.released, vec![frame]);
        }
        assert_eq!(
            frames.imports(SURFACE),
            1,
            "one import for one texture id and generation"
        );
        let rgba = compose(&gpu, &mut compositor, SIZE);
        assert!(
            near(pixel(&rgba, 64, 30, 10), blue),
            "{:?}",
            pixel(&rgba, 64, 30, 10)
        );
        frames.ended(SURFACE);
        assert_eq!(
            frames.imports(SURFACE),
            0,
            "a process's imports end with it"
        );
        assert!(
            near(
                pixel(&compose(&gpu, &mut compositor, SIZE), 64, 30, 10),
                blue
            ),
            "the last frame stays"
        );

        let gone = attach(
            9,
            SIZE,
            SurfaceFormat::Bgra8,
            u64::from(u32::MAX - 1),
            vec![],
            SurfaceReleaseWhen::AfterCopy,
        );
        let refused = frames.attach(&mut compositor, SURFACE, &gone, Source::Handle);
        assert!(
            matches!(refused, Err(AttachError::Import(_))),
            "{refused:?}"
        );
    }
}
