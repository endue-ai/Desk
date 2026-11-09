//! Shared by the GPU tests: a headless device (or a skip), rendering to RGBA, generated textures
//! and PNG snapshots compared with a tolerance.
#![allow(dead_code)]

use desk_compositor::headless::{Headless, Target, headless_device};
use desk_compositor::{Compositor, Scene, TextureId};
use std::path::PathBuf;

pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
/// Snapshot size: small, so the committed PNGs stay a few kilobytes.
pub const SIZE: (u32, u32) = (256, 160);
/// Largest per-channel difference a pixel may have and still match: backends rasterise and
/// filter slightly differently (Metal, DX12/WARP, Vulkan/lavapipe).
pub const CHANNEL_TOLERANCE: u8 = 8;
/// Share of pixels allowed past the tolerance (antialiased edges).
pub const OUTLIER_SHARE: f64 = 0.005;

/// A device, or `None` with the reason printed when the machine has no adapter at all (a CI
/// runner without lavapipe). `DESK_COMPOSITOR_REQUIRE_GPU=1` turns the skip into a failure.
pub fn gpu(test: &str) -> Option<Headless> {
    match headless_device() {
        Ok(gpu) => Some(gpu),
        Err(e) if std::env::var_os("DESK_COMPOSITOR_REQUIRE_GPU").is_some() => {
            panic!("{test}: {e} (DESK_COMPOSITOR_REQUIRE_GPU is set)")
        }
        Err(e) => {
            eprintln!("{test}: skipped, {e}");
            None
        }
    }
}

/// Render `scene` with a fresh compositor and read the frame back.
pub fn render(gpu: &Headless, scene: &Scene, textures: &[(TextureId, &wgpu::Texture)]) -> Vec<u8> {
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, FORMAT);
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

/// Compare a frame with `tests/snapshots/<name>.png`; `UPDATE_SNAPSHOTS=1` rewrites it instead.
/// On a mismatch the frame is written next to the test binary's temp dir for a look.
pub fn assert_snapshot(name: &str, size: (u32, u32), rgba: &[u8]) {
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
    let mut outliers = 0usize;
    let mut worst = 0u8;
    for (a, b) in rgba
        .as_chunks::<4>()
        .0
        .iter()
        .zip(expected.as_chunks::<4>().0)
    {
        let diff = a
            .iter()
            .zip(b)
            .map(|(x, y)| x.abs_diff(*y))
            .max()
            .unwrap_or(0);
        worst = worst.max(diff);
        outliers += usize::from(diff > CHANNEL_TOLERANCE);
    }
    let allowed = ((size.0 * size.1) as f64 * OUTLIER_SHARE) as usize;
    if outliers > allowed {
        let actual = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("{name}.actual.png"));
        write_png(&actual, size, rgba);
        panic!(
            "{name}: {outliers} pixels differ by more than {CHANNEL_TOLERANCE} (allowed {allowed}, worst {worst}); frame at {}",
            actual.display()
        );
    }
}
