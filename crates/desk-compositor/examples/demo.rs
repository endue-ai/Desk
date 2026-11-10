//! 15 moving, titled windows with generated textures, composed headless for N frames at 60 Hz
//! scene time in the endue theme (the desk's default look), switched live to another theme
//! halfway; prints the compose time per frame and the switch's frame, and writes the frame before
//! the switch and the last frame as PNG. Text is set in the machine's fonts.
//!
//! cargo run -p desk-compositor --example demo -- [--frames 120] [--size 1920x1080] [--windows 15]
//!   [--switch 60] [--to amber|light] [--out demo.png]

mod shared;

use desk_compositor::headless::{Target, headless_device};
use desk_compositor::{ChromeTheme, Compositor};
use std::path::{Path, PathBuf};
use std::time::Instant;

struct Options {
    frames: usize,
    size: (u32, u32),
    windows: usize,
    switch: Option<usize>,
    to: String,
    out: PathBuf,
}

fn options() -> Options {
    let mut options = Options {
        frames: 120,
        size: (1920, 1080),
        windows: 15,
        switch: None,
        to: "amber".into(),
        out: std::env::temp_dir().join("desk-compositor-demo.png"),
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    for pair in args.chunks(2) {
        let value = pair.get(1).map(String::as_str).unwrap_or_default();
        match pair[0].as_str() {
            "--frames" => options.frames = value.parse().expect("--frames N"),
            "--windows" => options.windows = value.parse().expect("--windows N"),
            "--switch" => options.switch = Some(value.parse().expect("--switch N")),
            "--to" => options.to = value.into(),
            "--out" => options.out = PathBuf::from(value),
            "--size" => {
                let (w, h) = value.split_once('x').expect("--size WxH");
                options.size = (w.parse().expect("width"), h.parse().expect("height"));
            }
            other => panic!("unknown option {other}"),
        }
    }
    options
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = options();
    let gpu = headless_device()?;
    println!(
        "adapter: {} ({:?}, {:?})",
        gpu.adapter.name, gpu.adapter.backend, gpu.adapter.device_type
    );
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, shared::FORMAT);
    let loaded = Instant::now();
    let fonts = compositor.fonts();
    println!(
        "fonts: {} faces, sans-serif is {} ({:.0} ms)",
        fonts.faces(),
        fonts.sans_family(),
        loaded.elapsed().as_secs_f64() * 1000.0
    );
    let target = Target::new(&gpu.device, options.size, shared::FORMAT);
    let theme = ChromeTheme::from_tokens(&shared::look(""));
    let mut desk = shared::build(options.size, options.windows, &mut compositor, theme);
    let other = ChromeTheme::from_tokens(&shared::look(&format!("-{}", options.to)));
    let switch = options.switch.unwrap_or(options.frames / 2);
    let (mut compose, mut frame) = (Vec::new(), Vec::new());
    let mut last = None;
    for n in 0..options.frames {
        if n == switch {
            let before = options.out.with_extension("before.png");
            write_png(
                &before,
                options.size,
                &target.read_rgba(&gpu.device, &gpu.queue)?,
            )?;
            println!("frame before the switch written to {}", before.display());
            desk.chrome.set_theme(&mut desk.scene, other.clone());
        }
        let start = Instant::now();
        shared::animate(&mut desk, &mut compositor, n as f32 / 60.0);
        let stats = compositor.render(&desk.scene, &target.view, target.size);
        shared::wait(&gpu.device);
        frame.push(start.elapsed());
        compose.push(stats.compose_time);
        if n % 20 == 0 || n == switch || n + 1 == options.frames {
            let note = if n == switch {
                " <- theme switched to "
            } else {
                ""
            };
            println!(
                "frame {n:4}: compose {:.3} ms, frame {:.3} ms, {} nodes, {} draws, {} glyphs ({} missing), {} textures{note}{}",
                stats.compose_time.as_secs_f64() * 1000.0,
                frame[n].as_secs_f64() * 1000.0,
                stats.nodes_drawn,
                stats.draw_calls,
                stats.glyphs,
                stats.missing_glyphs,
                stats.textures_resident,
                if n == switch { options.to.as_str() } else { "" },
            );
        }
        last = Some(stats);
    }
    let [cmin, cmed, cp95, cmax] = shared::summary(&compose);
    let [fmin, fmed, fp95, fmax] = shared::summary(&frame);
    println!(
        "{} frames at {}x{}, {} windows; atlas {} glyphs on a {} texel page",
        options.frames,
        options.size.0,
        options.size.1,
        options.windows,
        compositor.glyphs_resident(),
        compositor.atlas_side()
    );
    println!(
        "compose (CPU: scene walk, layout, encode, submit) ms: min {cmin:.3} median {cmed:.3} p95 {cp95:.3} max {cmax:.3}"
    );
    println!(
        "frame (animate + compose + GPU done) ms:    min {fmin:.3} median {fmed:.3} p95 {fp95:.3} max {fmax:.3}"
    );
    if let Some(stats) = last {
        println!("last frame: {:?}", stats.damage);
    }
    let rgba = target.read_rgba(&gpu.device, &gpu.queue)?;
    write_png(&options.out, options.size, &rgba)?;
    println!("last frame written to {}", options.out.display());
    Ok(())
}

fn write_png(path: &Path, size: (u32, u32), rgba: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    let file = std::io::BufWriter::new(std::fs::File::create(path)?);
    let mut encoder = png::Encoder::new(file, size.0, size.1);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(rgba)?;
    Ok(())
}
