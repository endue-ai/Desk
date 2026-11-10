//! Shared by the GPU tests: one headless device per test binary (or a skip), rendering to RGBA,
//! generated textures and PNG snapshots compared with a tolerance per platform and adapter.
#![allow(dead_code)]

pub mod tolerance;

use desk_compositor::headless::{Headless, Target, headless_device};
use desk_compositor::{Compositor, Fonts, Scene, TextureId, Tokens};
use std::path::PathBuf;
use std::sync::OnceLock;
use tolerance::{AdapterKind, Tolerance, compare};

pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
/// Snapshot size: small, so the committed PNGs stay a few kilobytes.
pub const SIZE: (u32, u32) = (256, 160);
/// The pixel checks' tolerance (`near`), the snapshots' own row of `tolerance::tolerance`.
pub const CHANNEL_TOLERANCE: u8 = 8;

/// The device every test of this binary shares, or `None` with the reason printed when the machine
/// has no adapter at all (a CI runner without lavapipe). One device, never one per test: lavapipe
/// crashed (SIGSEGV) in 3 of 30 runs of `render_loop` when parallel tests each made and dropped a
/// device of their own, and in none of 30 runs each of `render_loop`, `text` and `theme_snapshots`
/// sharing this one in parallel (#58). `DESK_COMPOSITOR_REQUIRE_GPU=1`
/// turns the skip into a failure; `DESK_COMPOSITOR_ADAPTER=software` takes the software adapter
/// alone (lavapipe, WARP), as a CI runner without a GPU has, on a machine with one.
pub fn gpu(test: &str) -> Option<Headless> {
    static GPU: OnceLock<Result<Headless, String>> = OnceLock::new();
    match GPU.get_or_init(device) {
        Ok(gpu) => Some(Headless {
            device: gpu.device.clone(),
            queue: gpu.queue.clone(),
            adapter: gpu.adapter.clone(),
        }),
        Err(e) if std::env::var_os("DESK_COMPOSITOR_REQUIRE_GPU").is_some() => {
            panic!("{test}: {e} (DESK_COMPOSITOR_REQUIRE_GPU is set)")
        }
        Err(e) => {
            eprintln!("{test}: skipped, {e}");
            None
        }
    }
}

fn device() -> Result<Headless, String> {
    if std::env::var("DESK_COMPOSITOR_ADAPTER").is_ok_and(|v| v == "software") {
        software_device()
    } else {
        headless_device().map_err(|e| e.to_string())
    }
}

/// A device on the fallback adapter alone, refused unless it is a CPU rasteriser.
fn software_device() -> Result<Headless, String> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::from_env().unwrap_or(wgpu::Backends::PRIMARY),
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        force_fallback_adapter: true,
        ..Default::default()
    }))
    .map_err(|e| format!("no software adapter (DESK_COMPOSITOR_ADAPTER=software): {e}"))?;
    let info = adapter.get_info();
    if AdapterKind::of(info.device_type) != AdapterKind::Software {
        return Err(format!(
            "the fallback adapter {} is not a software one",
            info.name
        ));
    }
    let limits = wgpu::Limits::downlevel_defaults().using_resolution(adapter.limits());
    let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("desk-compositor tests (software)"),
        required_limits: limits,
        ..Default::default()
    }))
    .map_err(|e| e.to_string())?;
    Ok(Headless {
        device,
        queue,
        adapter: info,
    })
}

/// The snapshot tolerance for the adapter `gpu` renders on, on this platform.
pub fn snapshot_tolerance(gpu: &Headless) -> Tolerance {
    tolerance::tolerance(
        std::env::consts::OS,
        AdapterKind::of(gpu.adapter.device_type),
    )
}

/// The fonts in `tests/fonts` (Inter, and Noto Sans KR and SC cut down to the tests' strings),
/// nothing of the machine's: text sets the same on every OS.
pub fn test_fonts() -> Fonts {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fonts");
    let files = ["inter.ttf", "noto-sans-kr.ttf", "noto-sans-sc.ttf"];
    Fonts::from_data(files.map(|f| std::fs::read(dir.join(f)).expect("test font")))
}

/// A look as the runtime sends it for the compositor: the bridge vector
/// `theme-tokens-request<suffix>.json` (`""` the endue theme dark, `-light`, `-amber`), the same
/// tables the runtime's test says it sends.
pub fn look(suffix: &str) -> Tokens {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs/bridge/v0/vectors/valid")
        .join(format!("theme-tokens-request{suffix}.json"));
    let doc: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).expect("theme vector")).expect("json");
    let tokens = doc["instance"]["params"]["tokens"]
        .as_object()
        .expect("tokens");
    tokens
        .iter()
        .map(|(name, value)| (name.clone(), value.as_str().unwrap_or_default().to_owned()))
        .collect()
}

/// A compositor that sets text in [`test_fonts`].
pub fn compositor(gpu: &Headless) -> Compositor {
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
    compositor.set_fonts(test_fonts());
    compositor
}

/// Render `scene` with a fresh compositor and read the frame back.
pub fn render(gpu: &Headless, scene: &Scene, textures: &[(TextureId, &wgpu::Texture)]) -> Vec<u8> {
    let mut compositor = compositor(gpu);
    for (id, texture) in textures {
        compositor.register_texture(*id, texture);
    }
    let target = Target::new(&gpu.device, scene.viewport(), FORMAT);
    let stats = compositor.render(scene, &target.view, target.size);
    assert!(stats.drawn, "a first frame always draws");
    target.read_rgba(&gpu.device, &gpu.queue).expect("readback")
}

/// RGBA of the pixel at `(x, y)`.
pub fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * width + x) * 4) as usize;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

/// Whether two colours match within the snapshot tolerance.
pub fn near(a: [u8; 4], b: [u8; 4]) -> bool {
    a.iter()
        .zip(b)
        .all(|(x, y)| x.abs_diff(y) <= CHANNEL_TOLERANCE)
}

/// A checkerboard of `cell`-pixel squares.
pub fn checker(size: (u32, u32), cell: u32, a: [u8; 4], b: [u8; 4]) -> Vec<u8> {
    let cell_of = move |x: u32, y: u32| (x / cell + y / cell).is_multiple_of(2);
    (0..size.1)
        .flat_map(|y| (0..size.0).map(move |x| if cell_of(x, y) { a } else { b }))
        .flatten()
        .collect()
}

/// Red rising left to right, green top to bottom, blue constant; opaque.
pub fn gradient(size: (u32, u32)) -> Vec<u8> {
    let (w, h) = (size.0.max(2) - 1, size.1.max(2) - 1);
    (0..size.1)
        .flat_map(|y| {
            (0..size.0).map(move |x| [(x * 255 / w) as u8, (y * 255 / h) as u8, 160, 255])
        })
        .flatten()
        .collect()
}

fn snapshot_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/snapshots")
        .join(format!("{name}.png"))
}

pub fn write_png(path: &std::path::Path, size: (u32, u32), rgba: &[u8]) {
    let file = std::fs::File::create(path).expect("create png");
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), size.0, size.1);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
}

fn read_png(path: &std::path::Path) -> Option<((u32, u32), Vec<u8>)> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = png::Decoder::new(std::io::BufReader::new(file))
        .read_info()
        .ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
        return None;
    }
    buf.truncate(info.buffer_size());
    Some(((info.width, info.height), buf))
}

/// Compare a frame `gpu` rendered with `tests/snapshots/<name>.png` under the tolerance of its
/// platform and adapter; `UPDATE_SNAPSHOTS=1` rewrites it instead. Every comparison prints its
/// worst difference and outliers (`--nocapture`), so a CI log says how close a backend came. On a
/// mismatch the frame is written to the test binary's temp dir for a look.
pub fn assert_snapshot(gpu: &Headless, name: &str, size: (u32, u32), rgba: &[u8]) {
    let path = snapshot_path(name);
    if std::env::var_os("UPDATE_SNAPSHOTS").is_some_and(|v| v == "1") {
        write_png(&path, size, rgba);
        eprintln!("{name}: snapshot written to {}", path.display());
        return;
    }
    let Some((expected_size, expected)) = read_png(&path) else {
        panic!(
            "{name}: no snapshot at {} (run with UPDATE_SNAPSHOTS=1)",
            path.display()
        );
    };
    assert_eq!(expected_size, size, "{name}: snapshot size");
    let tolerance = snapshot_tolerance(gpu);
    let seen = compare(rgba, &expected, &tolerance);
    let adapter = format!(
        "{} ({:?}, {:?}) on {}",
        gpu.adapter.name,
        gpu.adapter.backend,
        gpu.adapter.device_type,
        std::env::consts::OS
    );
    eprintln!(
        "{name}: worst {}, {} pixels past {} (allowed {}) on {adapter}",
        seen.worst, seen.outliers, tolerance.channel, seen.allowed
    );
    if !seen.matches() {
        let actual = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}.actual.png"));
        write_png(&actual, size, rgba);
        panic!(
            "{name}: {} pixels differ by more than {} (allowed {}, worst {}) on {adapter}, whose \
             tolerance is {}; frame at {}",
            seen.outliers,
            tolerance.channel,
            seen.allowed,
            seen.worst,
            tolerance.why,
            actual.display()
        );
    }
}
