//! What a surface's frame changes (R1): only its picture, so the next frame draws the scene as it
//! was laid out, or the scene too.

use desk_surface::generated::{SurfaceFormat, SurfacePixelRect, SurfaceReleaseWhen};

use super::taken;
use crate::web_host::paint::{Painted, attach, software_handle};

fn frame(surface: &str, size: (u32, u32), damage: &[(u64, u64, u64, u64)]) -> super::SurfaceAttach {
    let painted = Painted {
        id: 7,
        size,
        format: SurfaceFormat::Bgra8,
        handle: software_handle(),
        release: SurfaceReleaseWhen::AfterCopy,
    };
    let damage = (damage.iter())
        .map(|&(x, y, width, height)| SurfacePixelRect {
            x,
            y,
            width,
            height,
        })
        .collect();
    attach(surface, 2, 1, &painted, damage)
}

#[test]
fn a_caret_blink_changes_only_its_surfaces_picture() {
    let blink = frame("main.endue-terminal", (656, 422), &[(40, 60, 17, 34)]);
    assert!(taken(&blink, (656, 422), Some((656, 422))));
    let wide = frame("main.endue-git", (100, 50), &[(0, 0, 400, 400)]);
    assert!(taken(&wide, (100, 50), Some((100, 50))), "damage past it");
}

#[test]
fn a_first_frame_a_new_size_and_the_desks_page_lay_the_scene_out_again() {
    let first = frame("main.endue-notes", (656, 422), &[]);
    assert!(!taken(&first, (656, 422), None), "a first frame");
    let grown = frame("main.endue-notes", (700, 422), &[(0, 0, 700, 422)]);
    assert!(!taken(&grown, (700, 422), Some((656, 422))), "a new size");
    let page = frame(super::super::PAGE, (2560, 1600), &[(0, 0, 10, 10)]);
    assert!(
        !taken(&page, (2560, 1600), Some((2560, 1600))),
        "the page's paints place the windows' page parts"
    );
}
