//! A picture of a new size waits for the next layout, and a picture replaced retires until the
//! render thread drew a frame handed since (#249, ADR 0235).

use desk_compositor::headless::{headless_device, upload_rgba};
use desk_compositor::{Compositor, Source};
use desk_surface::generated::{
    SurfaceAttach, SurfaceAttachType, SurfaceFormat, SurfaceIoSurfaceHandle,
    SurfaceIoSurfaceHandleKind, SurfaceReleaseWhen, SurfaceTexture, SurfaceTextureHandle,
};

use super::super::Shared;
use crate::web_host::SurfaceSink;

const NOTES: &str = "main.endue-notes";

/// The compositor's state on the headless GPU, or `None` on a machine without one.
fn shared() -> Option<(Shared, wgpu::Device, wgpu::Queue)> {
    let gpu = headless_device()
        .map_err(|why| eprintln!("composed::waiting: skipped, {why}"))
        .ok()?;
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let compositor = Compositor::new(&gpu.device, &gpu.queue, format);
    let shared = Shared::new(compositor);
    shared.lock().wait_for_layouts();
    Some((shared, gpu.device, gpu.queue))
}

/// The Notes plugin paints `size` pixels.
fn paint(gpu: &(Shared, wgpu::Device, wgpu::Queue), size: (u32, u32)) -> bool {
    let (sink, device, queue) = gpu;
    let rgba = [40u8, 80, 120, 255].repeat((size.0 * size.1) as usize);
    let texture = upload_rgba(device, queue, size, &rgba);
    let attach = SurfaceAttach {
        r#type: SurfaceAttachType::Attach,
        surface: NOTES.into(),
        frame: 1,
        texture: SurfaceTexture {
            id: 3,
            generation: u64::from(size.0) << 32 | u64::from(size.1),
            width: u64::from(size.0),
            height: u64::from(size.1),
            format: SurfaceFormat::Rgba8,
            handle: SurfaceTextureHandle::SurfaceIoSurface(SurfaceIoSurfaceHandle {
                kind: SurfaceIoSurfaceHandleKind::Iosurface,
                id: 3,
                port_index: None,
            }),
        },
        damage: Vec::new(),
        release: SurfaceReleaseWhen::AfterCopy,
        fence_fd_index: None,
    };
    sink.attach(&attach, Source::Imported(&texture)).is_ok()
}

/// The size of the Notes picture the next scene draws, and its texture.
fn shown(sink: &Shared) -> Option<(desk_compositor::TextureId, (u32, u32))> {
    let composed = sink.lock();
    let id = composed.texture_of(NOTES)?;
    Some((id, composed.frames.size(id)?))
}

#[test]
fn a_paint_of_a_new_size_shows_from_the_next_layout_and_the_picture_it_replaces_retires() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    assert!(paint(&gpu, (600, 400)));
    let (first, size) = shown(sink).expect("its picture");
    assert_eq!(size, (600, 400));
    // Frame 1, laid out with that picture, waits for the render thread; the plugin grows.
    sink.lock().handed(1);
    sink.lock().drawn();
    assert!(paint(&gpu, (640, 400)));
    assert_eq!(
        shown(sink),
        Some((first, (600, 400))),
        "frame 1's picture keeps its size"
    );
    assert!(sink.lock().dirty, "the next layout shows the new size");
    // The next layout shows it; the picture it replaces stays while frame 1 may draw it.
    sink.lock().show_waiting();
    let (grown, size) = shown(sink).expect("its new picture");
    assert_eq!(size, (640, 400));
    assert_ne!(grown, first);
    sink.lock().retire_drawn(1);
    assert!(
        sink.lock().frames.size(first).is_some(),
        "frame 1 may draw it still"
    );
    sink.lock().handed(2);
    sink.lock().retire_drawn(2);
    assert_eq!(sink.lock().frames.size(first), None, "drawn past: it goes");
    // A paint of its size goes straight into its picture.
    assert!(paint(&gpu, (640, 400)));
    assert_eq!(shown(sink), Some((grown, (640, 400))));
}

#[test]
fn without_a_render_thread_a_new_size_shows_at_once() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    sink.lock().waiting.on = false;
    assert!(paint(&gpu, (600, 400)));
    assert!(
        paint(&gpu, (640, 400)),
        "the surface probe lays out and draws at once"
    );
    assert_eq!(shown(sink).map(|(_, s)| s), Some((640, 400)));
}

#[test]
fn a_paint_of_its_size_again_drops_the_picture_that_waited() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    assert!(paint(&gpu, (600, 400)));
    let (first, _) = shown(sink).expect("its picture");
    assert!(paint(&gpu, (640, 400)), "a new size, waiting");
    assert!(
        paint(&gpu, (600, 400)),
        "back to its size: the newest paint"
    );
    sink.lock().show_waiting();
    assert_eq!(
        shown(sink),
        Some((first, (600, 400))),
        "the newest picture shows"
    );
}
