//! How far a frame may be from its snapshot, per platform and adapter, and the comparison itself.
//! The PNGs in `tests/snapshots/` are blessed on the reference machine (Metal on Apple silicon); other
//! backends rasterise edges and filter textures a little differently, so each platform and adapter
//! kind has a row of its own with the reason for its numbers. Pure: `tests/snapshot_gate.rs`.

/// A channel difference a pixel may have and still match, and the share of pixels allowed past it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tolerance {
    pub channel: u8,
    pub outlier_share: f64,
    /// Where the numbers come from.
    pub why: &'static str,
}

/// What kind of adapter rendered the frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdapterKind {
    /// A CPU rasteriser: lavapipe (llvmpipe) on Linux, WARP on Windows; what CI runners without a
    /// GPU have.
    Software,
    Hardware,
}

impl AdapterKind {
    pub fn of(device_type: wgpu::DeviceType) -> AdapterKind {
        if device_type == wgpu::DeviceType::Cpu {
            AdapterKind::Software
        } else {
            AdapterKind::Hardware
        }
    }
}

/// The row for `os` (`std::env::consts::OS`) and `kind`.
pub fn tolerance(os: &str, kind: AdapterKind) -> Tolerance {
    match (os, kind) {
        ("macos", _) => Tolerance {
            channel: 8,
            outlier_share: 0.005,
            why: "the snapshots' own platform (Metal, Apple M4 Max); antialiased edges only",
        },
        ("linux", AdapterKind::Software) => Tolerance {
            channel: 8,
            outlier_share: 0.005,
            why: "lavapipe (llvmpipe, LLVM 19, Mesa on Debian trixie, arm64), measured 2026-11-10: \
                  a worst difference of 3 and no pixel past 8 across all seven snapshots",
        },
        ("linux", AdapterKind::Hardware) => Tolerance {
            channel: 10,
            outlier_share: 0.01,
            why: "Vulkan on a GPU, not measured yet: lavapipe's row widened by a quarter for vendor \
                  filtering; #61 records the first runs",
        },
        ("windows", AdapterKind::Software) => Tolerance {
            channel: 10,
            outlier_share: 0.01,
            why: "WARP (DX12), not measured yet: lavapipe's row widened by a quarter; #61 records \
                  the first runs",
        },
        _ => Tolerance {
            channel: 10,
            outlier_share: 0.01,
            why: "not measured: lavapipe's row widened by a quarter until a run says otherwise",
        },
    }
}

/// How a frame compares with its snapshot.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Comparison {
    /// The largest channel difference of any pixel.
    pub worst: u8,
    /// Pixels with a channel past the tolerance.
    pub outliers: usize,
    /// How many outliers the tolerance allows for this size.
    pub allowed: usize,
}

impl Comparison {
    pub fn matches(&self) -> bool {
        self.outliers <= self.allowed
    }
}

/// Compare two RGBA8 frames of the same size under `tolerance`.
pub fn compare(actual: &[u8], expected: &[u8], tolerance: &Tolerance) -> Comparison {
    let mut outliers = 0usize;
    let mut worst = 0u8;
    for (a, b) in actual
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
        outliers += usize::from(diff > tolerance.channel);
    }
    let pixels = expected.len().min(actual.len()) / 4;
    Comparison {
        worst,
        outliers,
        allowed: (pixels as f64 * tolerance.outlier_share) as usize,
    }
}
