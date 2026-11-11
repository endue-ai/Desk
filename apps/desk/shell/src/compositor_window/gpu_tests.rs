//! A window that cannot present (#155; QA 06 #4, where the desk ended with wgpu's "Cannot get
//! non-existent resource SurfaceId"): it stops presenting in the middle of a resize, a frame of its
//! surface in hand, and goes on composing off screen. The surface is on a `CAMetalLayer` of the
//! test's own, in no window, so the test needs a Metal device and no window server.

use std::ffi::c_void;
use std::time::Instant;

use desk_compositor::headless::Target;
use desk_compositor::{Compositor, Scene};
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};

use super::{Gpu, PAUSED, instance};

/// A GPU presenting to a layer in no window (the layer kept with it), or `None` with the reason
/// where Metal has no device or the layer no surface.
#[allow(unsafe_code)]
fn on_a_layer(test: &str, size: (u32, u32)) -> Option<(Gpu, Retained<AnyObject>)> {
    // SAFETY: `+[CAMetalLayer new]` answers a retained layer; QuartzCore is linked by wgpu's Metal
    // backend.
    let layer: Retained<AnyObject> = unsafe { msg_send![class!(CAMetalLayer), new] };
    let instance = instance();
    let raw = Retained::as_ptr(&layer).cast_mut().cast::<c_void>();
    // SAFETY: `raw` is a live CAMetalLayer, kept for as long as the surface by the caller.
    let target = wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(raw);
    let made = unsafe { instance.create_surface_unsafe(target) }.map_err(|e| e.to_string());
    match made.and_then(|surface| Gpu::on(&instance, Some(surface), size)) {
        Ok(gpu) => Some((gpu, layer)),
        Err(e) => {
            eprintln!("{test}: skipped, {e}");
            None
        }
    }
}

/// A desk frame composed into `view`, `size` its pixels, as the window's tick composes one.
fn compose(gpu: &Gpu, compositor: &mut Compositor, view: &wgpu::TextureView, size: (u32, u32)) {
    let scene = Scene::new(size.0, size.1);
    compositor.invalidate();
    compositor.render(&scene, view, size);
    let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
}

#[test]
fn a_window_that_stops_presenting_mid_resize_goes_on_composing() {
    let test = "a_window_that_stops_presenting_mid_resize_goes_on_composing";
    let Some((mut gpu, _layer)) = on_a_layer(test, (320, 200)) else {
        return;
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, gpu.format);
    // The window is being resized: a new size, a frame at it, presented.
    for size in [(330, 206), (340, 212)] {
        gpu.resize(size.0, size.1);
        let frame = gpu
            .frame()
            .expect("a layer in no window hands out its images");
        let view = frame.texture.create_view(&Default::default());
        compose(&gpu, &mut compositor, &view, size);
        gpu.queue.present(frame);
    }
    // The third image that came late: presenting stops with it in hand, and it is still drawn and
    // handed back.
    let frame = gpu.frame().expect("an image");
    let stopped = Instant::now();
    gpu.stop_presenting(stopped);
    let view = frame.texture.create_view(&Default::default());
    compose(&gpu, &mut compositor, &view, (340, 212));
    gpu.queue.present(frame);
    assert!(!gpu.presents(), "it presents no more");
    assert_eq!(
        gpu.withheld(),
        Some(stopped + PAUSED),
        "it asks again after a while"
    );
    // The resize goes on, and the desk composes off screen, for the router and the captures.
    for size in [(350, 218), (360, 224)] {
        gpu.resize(size.0, size.1);
        assert!(!gpu.presents());
        let target = Target::new(&gpu.device, size, gpu.format);
        compose(&gpu, &mut compositor, &target.view, size);
    }
    // The window shows again: it presents again, at the size the resize ended at.
    gpu.resume();
    assert!(gpu.presents());
    assert_eq!(gpu.withheld(), None);
    let frame = gpu.frame().expect("an image once shown again");
    assert_eq!((frame.texture.width(), frame.texture.height()), (360, 224));
    let view = frame.texture.create_view(&Default::default());
    compose(&gpu, &mut compositor, &view, (360, 224));
    gpu.queue.present(frame);
}

#[test]
fn a_window_without_a_surface_has_nothing_to_stop() {
    let Some(gpu) = Gpu::on(&instance(), None, (64, 48))
        .map_err(|e| eprintln!("a_window_without_a_surface_has_nothing_to_stop: skipped, {e}"))
        .ok()
    else {
        return;
    };
    let mut gpu = gpu;
    gpu.stop_presenting(Instant::now());
    assert_eq!(gpu.withheld(), None, "headless: no look to wake for");
    assert!(gpu.frame().is_none());
    gpu.resume();
    assert!(!gpu.presents());
}
