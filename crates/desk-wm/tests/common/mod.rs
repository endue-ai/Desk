//! What the ported TS tests build their desks from: `sampleState`'s drawer (`shell/state.ts`), a
//! window at a place, a desktop's layout, and the plugin windows handed over in their slots.

#![allow(dead_code)]

use desk_wm::{Adopted, Desk, DesktopLayout, DrawerItem, DrawerKind, Placement, Rect};

/// `Date.parse("2026-10-28T09:00:00.000Z")`: the wall clock the shell's tests date the drawer from.
pub const EPOCH: i64 = 1_793_178_000_000;
pub const HOUR: i64 = 3_600_000;

/// A window of `plugin` at `x`, `y`, `w` × `h`.
pub fn at(id: &str, plugin: &str, x: f64, y: f64, w: f64, h: f64) -> Placement {
    Placement::new(id, plugin, Rect::new(x, y, w, h))
}

/// A desktop's whole layout: `surfaces`, Eris in her default place, the rail and the drawer shown.
pub fn layout(surfaces: Vec<Placement>) -> DesktopLayout {
    DesktopLayout {
        surfaces,
        ..DesktopLayout::default()
    }
}

/// The drawer `sampleState(lang, epoch)` starts with: a file and two recent items.
pub fn sample_drawer(epoch: i64) -> Vec<DrawerItem> {
    let item = |id: &str, kind, name: &str, hours: i64| DrawerItem {
        id: id.into(),
        kind,
        name: name.into(),
        at: epoch - hours * HOUR,
        placement: None,
    };
    vec![
        item("file-brief", DrawerKind::File, "brief.pdf", 3),
        item("recent-weather", DrawerKind::Recent, "Weather this week", 2),
        item("recent-summary", DrawerKind::Recent, "Inbox summary", 18),
    ]
}

/// The sample desk the shell's tests start from: the base profile's four desktops, nothing
/// placed, the sample drawer.
pub fn sample(epoch: i64) -> Desk {
    let mut desk = Desk::default();
    desk.set(|d| d.drawer = sample_drawer(epoch));
    desk
}

/// Plugin surfaces handed over, in slots 0, 1, 2, ..., none placed by a layout.
pub fn adopt(desk: &mut Desk, ids: &[&str]) {
    desk.set(|d| {
        d.adopted = ids
            .iter()
            .enumerate()
            .map(|(slot, id)| Adopted {
                id: (*id).into(),
                title: (*id).into(),
                slot: Some(slot),
                at: None,
                area: None,
            })
            .collect();
    });
}

/// The ids of a list of windows, in order.
pub fn ids(windows: &[Placement]) -> Vec<String> {
    windows.iter().map(|p| p.id.clone()).collect()
}

/// The drawer by what each item holds: a put-away window's id, else the item's own.
pub fn drawer_ids(desk: &Desk) -> Vec<String> {
    desk.drawer
        .iter()
        .map(|d| d.placement.as_ref().map_or(d.id.clone(), |p| p.id.clone()))
        .collect()
}

/// A window's rect as the desk in front draws it, when it is there.
pub fn rect_of(desk: &Desk, id: &str) -> Option<Rect> {
    desk.windows()
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.rect())
}
