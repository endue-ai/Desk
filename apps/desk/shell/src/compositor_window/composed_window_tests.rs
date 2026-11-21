//! A window's own page's paints between its picture and the textures aside, and the sizes a
//! picture of it leaves its panes (ADR 0233); a paint aside that failed, the desk's page's too
//! (#330).

use desk_compositor::{Rect, TextureId};

use desk_compositor::headless::{headless_device, upload_rgba};
use desk_compositor::{Compositor, Source};
use desk_surface::generated::{
    SurfaceAttach, SurfaceAttachType, SurfaceFormat, SurfaceIoSurfaceHandle,
    SurfaceIoSurfaceHandleKind, SurfaceReleaseWhen, SurfaceTexture, SurfaceTextureHandle,
};

use super::super::Shared;
use super::{KEPT, MOST_ASIDE, MOST_LOOKS, PageWait, Paned, To, waits_for};
use crate::compositor_window::draw::anchor::Anchor;
use crate::web_host::SurfaceSink;

const SHOWN: Option<(u32, u32)> = Some((1200, 800));

/// The Terminal's window at 600×400 CSS pixels, its one pane under a 36-pixel title bar, 1 in.
fn terminal() -> Paned {
    Paned {
        page: "window:endue.terminal".into(),
        placed: Rect::new(100.0, 50.0, 600.0, 400.0),
        laid: (600.0, 400.0),
        corner: Anchor::default(),
        panes: vec![(
            "plugin:endue.terminal".into(),
            Rect::new(1.0, 36.0, 598.0, 363.0),
        )],
    }
}

#[test]
fn a_paint_of_a_new_size_waits_aside_only_in_a_window_with_a_plugin_pane() {
    let mut page = PageWait::default();
    assert_eq!(page.paint((1200, 800), None, true), To::Shown, "its first");
    assert_eq!(page.paint((1200, 800), SHOWN, true), To::Shown, "its size");
    assert_eq!(
        page.paint((1280, 800), SHOWN, false),
        To::Shown,
        "no pane to wait for"
    );
    assert_eq!(page.paint((1280, 800), SHOWN, true), To::Aside(None));
    assert_eq!(page.keep((1280, 800), TextureId(7)), None);
    assert_eq!(
        page.paint((1280, 800), SHOWN, true),
        To::Aside(Some(TextureId(7)))
    );
    assert!(page.waits());
}

#[test]
fn a_picture_aside_shows_once_its_panes_plugins_have_their_sizes() {
    let mut page = PageWait::default();
    for (i, w) in [1280, 1360, 1440].into_iter().enumerate() {
        assert_eq!(page.paint((w, 800), SHOWN, true), To::Aside(None));
        page.keep((w, 800), TextureId(10 + i as u64));
    }
    assert_eq!(
        page.pick(|_| false),
        None,
        "no plugin has painted a size of them"
    );
    // The plugin has painted the second size: that one shows, the first is left behind.
    let found = page.pick(|(w, _)| w == 1360);
    assert_eq!(found, Some((TextureId(11), vec![TextureId(10)])));
    assert!(page.waits(), "the newest still waits");
    assert_eq!(page.pick(|_| true), Some((TextureId(12), vec![])));
    assert!(!page.waits());
}

#[test]
fn the_newest_sizes_wait_and_a_repainted_one_is_the_newest() {
    let mut page = PageWait::default();
    for i in 0..=KEPT {
        let size = (1280 + 80 * i as u32, 800);
        assert_eq!(page.paint(size, SHOWN, true), To::Aside(None));
        let gone = page.keep(size, TextureId(20 + i as u64));
        assert_eq!(gone, (i == KEPT).then_some(TextureId(20)), "{i}");
    }
    assert_eq!(
        page.paint((1360, 800), SHOWN, true),
        To::Aside(Some(TextureId(21)))
    );
    assert_eq!(
        page.pick(|_| true).map(|f| f.0),
        Some(TextureId(21)),
        "repainted last"
    );
}

#[test]
fn a_page_whose_panes_never_take_its_size_still_shows_by_a_count() {
    let mut page = PageWait::default();
    page.paint((1280, 800), SHOWN, true);
    page.keep((1280, 800), TextureId(7));
    for i in 0..MOST_LOOKS {
        assert_eq!(page.pick(|_| false), None, "scene {i}");
    }
    assert_eq!(
        page.pick(|_| false),
        Some((TextureId(7), vec![])),
        "a count of scenes"
    );
    // A count of paints aside in a row draws the next as it comes.
    let mut page = PageWait::default();
    for i in 0..MOST_ASIDE {
        let size = (1280 + i as u32, 800);
        assert!(matches!(page.paint(size, SHOWN, true), To::Aside(_)), "{i}");
        page.keep(size, TextureId(30 + i as u64));
    }
    assert_eq!(
        page.paint((1400, 800), SHOWN, true),
        To::Shown,
        "a count, not a time"
    );
    assert_eq!(page.clear().len(), KEPT, "the older ones go");
}

#[test]
fn a_picture_leaves_each_pane_what_its_frame_holds() {
    let terminal = terminal();
    // At the window's size: the pane's body.
    assert_eq!(
        terminal.leaves((1200, 800), 2.0),
        vec![("plugin:endue.terminal", (1196, 726))]
    );
    // A picture 40 CSS pixels wider and 20 higher: the pane at the frame's edges keeps its inset.
    assert_eq!(
        terminal.leaves((1280, 840), 2.0),
        vec![("plugin:endue.terminal", (1276, 766))]
    );
    // Narrower: cut at the frame's edge with its inset still.
    assert_eq!(
        terminal.leaves((1100, 800), 2.0),
        vec![("plugin:endue.terminal", (1096, 726))]
    );
}

#[test]
fn only_a_window_of_one_pane_waits_for_its_plugin() {
    assert!(waits_for(1));
    assert!(
        !waits_for(2),
        "a split's panes take a share the scene draws from the newest plan"
    );
    assert!(!waits_for(0));
}

const PAGE: &str = "window:endue.terminal";
const PLUGIN: &str = "plugin:endue.terminal";

/// The compositor's state on the headless GPU, or `None` on a machine without one.
fn shared() -> Option<(Shared, wgpu::Device, wgpu::Queue)> {
    let gpu = match headless_device() {
        Ok(gpu) => gpu,
        // As the compositor's own GPU tests: a skip, or a failure where a GPU is required.
        Err(why) if std::env::var_os("DESK_COMPOSITOR_REQUIRE_GPU").is_some() => {
            panic!("no GPU: {why} (DESK_COMPOSITOR_REQUIRE_GPU is set)")
        }
        Err(why) => {
            eprintln!("composed::window: skipped, {why}");
            return None;
        }
    };
    eprintln!("composed::window: on {:?}", gpu.adapter.backend);
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let compositor = Compositor::new(&gpu.device, &gpu.queue, format);
    Some((Shared::new(compositor), gpu.device, gpu.queue))
}

/// `surface` paints `size` pixels; `given` is the texture's size the host imported.
fn paint(
    gpu: &(Shared, wgpu::Device, wgpu::Queue),
    surface: &str,
    size: (u32, u32),
    given: (u32, u32),
) -> bool {
    let (sink, device, queue) = gpu;
    let rgba = [40u8, 80, 120, 255].repeat((given.0 * given.1) as usize);
    let texture = upload_rgba(device, queue, given, &rgba);
    let attach = SurfaceAttach {
        r#type: SurfaceAttachType::Attach,
        surface: surface.into(),
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

/// The window's page's picture's size, as the scene draws it.
fn page_size(sink: &Shared) -> Option<(u32, u32)> {
    let composed = sink.lock();
    composed.frames.size(composed.texture_of(PAGE)?)
}

/// The Terminal's window drawn at 1200×800 device pixels, its plugin at its pane's 1196×726.
fn at_rest(gpu: &(Shared, wgpu::Device, wgpu::Queue)) {
    let sink = &gpu.0;
    assert!(paint(gpu, PAGE, (1200, 800), (1200, 800)));
    sink.lock().pages_wait(&[terminal()], 2.0);
    sink.lock().panes_drawn(&[(PLUGIN.into(), (1196, 726))]);
    assert!(paint(gpu, PLUGIN, (1196, 726), (1196, 726)));
}

#[test]
fn a_waiting_page_asks_for_scenes_and_shows_once_its_plugin_has_its_size() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    at_rest(&gpu);
    // The window's page painted 1280×840 first: its plugin has nothing of 1276×766 yet.
    assert!(paint(&gpu, PAGE, (1280, 840), (1280, 840)));
    assert!(
        !sink.lock().pages_wait(&[terminal()], 2.0),
        "its plugin is not ready"
    );
    sink.lock().drawn();
    assert!(
        sink.lock().dirty,
        "a picture that waits asks for the next scene"
    );
    assert_eq!(
        page_size(sink),
        Some((1200, 800)),
        "the frame keeps its size"
    );
    // The plugin paints its new size, aside until its pane is drawn so (ADR 0227).
    assert!(paint(&gpu, PLUGIN, (1276, 766), (1276, 766)));
    assert!(
        sink.lock().pages_wait(&[terminal()], 2.0),
        "both have the size now"
    );
    assert_eq!(page_size(sink), Some((1280, 840)));
    sink.lock().drawn();
    assert!(!sink.lock().dirty, "nothing waits any more");
}

#[test]
fn a_page_waiting_on_a_plugin_that_never_paints_shows_after_a_count_of_scenes() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    at_rest(&gpu);
    assert!(paint(&gpu, PAGE, (1280, 840), (1280, 840)));
    for scene in 0..MOST_LOOKS {
        assert!(!sink.lock().pages_wait(&[terminal()], 2.0), "scene {scene}");
        sink.lock().drawn();
        assert!(sink.lock().dirty, "scene {scene} asks for the next");
    }
    assert!(
        sink.lock().pages_wait(&[terminal()], 2.0),
        "a count, not a time"
    );
    assert_eq!(page_size(sink), Some((1280, 840)));
}

#[test]
fn a_paint_aside_that_failed_is_never_shown() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    at_rest(&gpu);
    assert!(
        !paint(&gpu, PAGE, (1280, 840), (640, 420)),
        "the import does not match"
    );
    assert!(!sink.lock().pages_waiting(), "no picture waits");
    assert!(!sink.lock().pages_wait(&[terminal()], 2.0));
    assert_eq!(page_size(sink), Some((1200, 800)));
}

/// The desk's own page, whose paints of a size no report names wait aside for one (#269).
const DESK: &str = crate::compositor_window::PAGE;

/// The desk's page's picture's size, as the scene draws it.
fn desk_size(sink: &Shared) -> Option<(u32, u32)> {
    let composed = sink.lock();
    composed.frames.size(composed.texture_of(DESK)?)
}

#[test]
fn a_desk_page_paint_aside_that_failed_is_never_shown() {
    let Some(gpu) = shared() else { return };
    let sink = &gpu.0;
    assert!(paint(&gpu, DESK, (1280, 800), (1280, 800)));
    assert!(!sink.lock().page_laid((1280, 800)), "nothing aside");
    // The page painted 1440×900 before its report came, into its spare, and the paint failed.
    assert!(
        !paint(&gpu, DESK, (1440, 900), (720, 450)),
        "the import does not match"
    );
    assert!(
        !sink.lock().page_laid((1440, 900)),
        "its report finds no picture aside"
    );
    assert_eq!(desk_size(sink), Some((1280, 800)), "the last picture stays");
    // Its report came: its next paint of that size is drawn as it comes.
    assert!(paint(&gpu, DESK, (1440, 900), (1440, 900)));
    assert_eq!(desk_size(sink), Some((1440, 900)));
    // A size no report names waits aside again, in a spare of its own, until its report.
    assert!(paint(&gpu, DESK, (1600, 1000), (1600, 1000)));
    assert_eq!(desk_size(sink), Some((1440, 900)), "aside");
    assert!(sink.lock().page_laid((1600, 1000)));
    assert_eq!(desk_size(sink), Some((1600, 1000)));
}
