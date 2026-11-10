//! The snapshot gate itself (#58), without a GPU: each platform and adapter kind has a tolerance
//! with its reason, none so wide it would bless a wrong frame; a frame within the tolerance matches
//! and one past it in more than the outlier share does not; and every committed snapshot is one a
//! test compares.

mod support;

use std::path::PathBuf;

use support::tolerance::{AdapterKind, Tolerance, compare, tolerance};

const OSES: [&str; 4] = ["macos", "linux", "windows", "freebsd"];
const KINDS: [AdapterKind; 2] = [AdapterKind::Software, AdapterKind::Hardware];

fn frame(pixels: usize, rgba: [u8; 4]) -> Vec<u8> {
    rgba.repeat(pixels)
}

#[test]
fn every_platform_and_adapter_has_a_tolerance_with_its_reason() {
    for os in OSES {
        for kind in KINDS {
            let row = tolerance(os, kind);
            assert!(!row.why.is_empty(), "{os} {kind:?}");
            assert!(
                row.channel <= 16 && row.outlier_share <= 0.02,
                "{os} {kind:?} is so wide a wrong frame would pass: {row:?}"
            );
        }
    }
    let reference = tolerance("macos", AdapterKind::Hardware);
    assert_eq!((reference.channel, reference.outlier_share), (8, 0.005));
    assert_eq!(
        tolerance("linux", AdapterKind::Software),
        Tolerance {
            why: tolerance("linux", AdapterKind::Software).why,
            ..reference
        },
        "lavapipe, CI's adapter, was measured within the reference row"
    );
    assert_eq!(
        AdapterKind::of(wgpu::DeviceType::Cpu),
        AdapterKind::Software
    );
    assert_eq!(
        AdapterKind::of(wgpu::DeviceType::IntegratedGpu),
        AdapterKind::Hardware
    );
}

#[test]
fn a_frame_within_the_tolerance_matches_and_one_past_it_does_not() {
    let row = tolerance("macos", AdapterKind::Hardware);
    let pixels = 256 * 160;
    let expected = frame(pixels, [100, 100, 100, 255]);
    let within = frame(pixels, [108, 92, 100, 255]);
    let seen = compare(&within, &expected, &row);
    assert!(seen.matches(), "{seen:?}");
    assert_eq!((seen.worst, seen.outliers), (8, 0));

    let past = frame(pixels, [109, 100, 100, 255]);
    let seen = compare(&past, &expected, &row);
    assert!(!seen.matches(), "{seen:?}");
    assert_eq!(seen.outliers, pixels);

    let allowed = (pixels as f64 * row.outlier_share) as usize;
    assert_eq!(seen.allowed, allowed);
    let mut edges = expected.clone();
    for px in edges.as_chunks_mut::<4>().0.iter_mut().take(allowed) {
        px[0] = 0;
    }
    assert!(
        compare(&edges, &expected, &row).matches(),
        "antialiased edges within the share"
    );
    let mut more = edges.clone();
    more[allowed * 4] = 0;
    let seen = compare(&more, &expected, &row);
    assert!(!seen.matches(), "one pixel past the share: {seen:?}");
    assert_eq!(seen.worst, 100);
}

#[test]
fn a_wrong_colour_fails_under_every_row() {
    let pixels = 64 * 64;
    let blue = frame(pixels, [47, 111, 222, 255]);
    let swapped = frame(pixels, [222, 111, 47, 255]);
    for os in OSES {
        for kind in KINDS {
            let row = tolerance(os, kind);
            assert!(!compare(&swapped, &blue, &row).matches(), "{os} {kind:?}");
        }
    }
}

#[test]
fn every_committed_snapshot_is_compared_by_a_test() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests");
    let sources: String = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .map(|p| std::fs::read_to_string(p).unwrap())
        .collect();
    let snapshots: Vec<String> = std::fs::read_dir(dir.join("snapshots"))
        .unwrap()
        .filter_map(Result::ok)
        .filter_map(|e| {
            e.file_name()
                .to_str()?
                .strip_suffix(".png")
                .map(str::to_owned)
        })
        .collect();
    assert!(snapshots.len() >= 7, "{snapshots:?}");
    for name in snapshots {
        assert!(
            sources.contains(&format!("\"{name}\"")),
            "tests/snapshots/{name}.png is compared by no test"
        );
    }
}
