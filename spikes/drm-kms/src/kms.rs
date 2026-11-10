//! KMS through drm-rs (pure Rust ioctls, no libdrm): the card, its connectors, modes, CRTCs and
//! planes, the output the desk takes, and a `--list` report of what the hardware offers.

use drm::buffer::DrmFourcc;
use drm::control::{Device as ControlDevice, Mode, ModeTypeFlags, ResourceHandle, connector, crtc};
use drm::{ClientCapability, Device, DriverCapability};
use std::os::fd::{AsFd, BorrowedFd, OwnedFd};
use std::path::{Path, PathBuf};

/// An open DRM device node. drm-rs implements every ioctl on anything that is `AsFd`.
pub struct Card(pub OwnedFd);

impl AsFd for Card {
    fn as_fd(&self) -> BorrowedFd<'_> {
        self.0.as_fd()
    }
}
impl Device for Card {}
impl ControlDevice for Card {}

/// The connector, mode and CRTC the desk drives.
#[derive(Clone, Debug)]
pub struct Output {
    pub connector: connector::Handle,
    pub name: String,
    pub mode: Mode,
    pub crtc: crtc::Handle,
}

impl Output {
    pub fn size(&self) -> (u32, u32) {
        let (w, h) = self.mode.size();
        (u32::from(w), u32::from(h))
    }
}

/// The refresh rate in millihertz the way Mesa's `VK_KHR_display` reports a mode
/// (`wsi_display_mode_refresh` · 1000, rounded); wgpu looks the Vulkan mode up by exact match.
pub fn refresh_mhz(mode: &Mode) -> u32 {
    let (_, _, htotal) = mode.hsync();
    let (_, _, vtotal) = mode.vsync();
    let vscan = f64::from(mode.vscan().max(1));
    let hz = f64::from(mode.clock()) * 1000.0 / (f64::from(htotal) * f64::from(vtotal) * vscan);
    (hz * 1000.0).round() as u32
}

pub fn connector_name(info: &connector::Info) -> String {
    format!("{}-{}", info.interface().as_str(), info.interface_id())
}

/// `/dev/dri/card*`, in order.
pub fn cards() -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir("/dev/dri")
        .map(|dir| {
            dir.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("card"))
                })
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

/// Whether the card at `path` has a connected connector (opened read-only, no master needed).
pub fn has_connected_output(path: &Path) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let card = Card(file.into());
    let Ok(res) = card.resource_handles() else {
        return false;
    };
    res.connectors().iter().any(|c| {
        card.get_connector(*c, false)
            .is_ok_and(|i| i.state() == connector::State::Connected)
    })
}

/// The output to drive: `want` names a connector, `mode` a size (and refresh in Hz).
pub fn pick(
    card: &Card,
    want: Option<&str>,
    mode: Option<(u16, u16, Option<u32>)>,
) -> Result<Output, String> {
    let res = card
        .resource_handles()
        .map_err(|e| format!("DRM resources: {e}"))?;
    for &handle in res.connectors() {
        // A forced probe reads the EDID again: what a hotplug handler does too.
        let Ok(info) = card.get_connector(handle, true) else {
            continue;
        };
        let name = connector_name(&info);
        if info.state() != connector::State::Connected || want.is_some_and(|w| w != name) {
            continue;
        }
        let modes = info.modes();
        let chosen = match mode {
            Some((w, h, hz)) => modes.iter().find(|m| {
                m.size() == (w, h) && hz.is_none_or(|hz| (refresh_mhz(m) + 500) / 1000 == hz)
            }),
            None => modes
                .iter()
                .find(|m| m.mode_type().contains(ModeTypeFlags::PREFERRED))
                .or(modes.first()),
        };
        let Some(chosen) = chosen.copied() else {
            return Err(format!(
                "{name}: no mode {mode:?} among {} modes",
                modes.len()
            ));
        };
        let crtc = crtc_for(card, &res, &info).ok_or_else(|| format!("{name}: no free CRTC"))?;
        return Ok(Output {
            connector: handle,
            name,
            mode: chosen,
            crtc,
        });
    }
    Err(match want {
        Some(w) => format!("no connected connector named {w} (see --list)"),
        None => "no connected connector".into(),
    })
}

/// The CRTC the connector's encoder drives now, else the first one its encoders can drive.
fn crtc_for(
    card: &Card,
    res: &drm::control::ResourceHandles,
    info: &connector::Info,
) -> Option<crtc::Handle> {
    if let Some(crtc) = info
        .current_encoder()
        .and_then(|e| card.get_encoder(e).ok())
        .and_then(|e| e.crtc())
    {
        return Some(crtc);
    }
    info.encoders()
        .iter()
        .filter_map(|e| card.get_encoder(*e).ok())
        .flat_map(|e| res.filter_crtcs(e.possible_crtcs()))
        .next()
}

/// `--list`: what a person needs for #61 to choose a connector, a mode and a present path.
pub fn list(card: &Card, path: &Path) {
    println!("== {}", path.display());
    if let Ok(driver) = card.get_driver() {
        println!(
            "driver: {} ({})",
            driver.name().to_string_lossy(),
            driver.description().to_string_lossy()
        );
    }
    let cap = |c| {
        card.get_driver_capability(c)
            .map_or("?".into(), |v| v.to_string())
    };
    println!(
        "caps: dumb={} prime={} addfb2-modifiers={} async-flip={} cursor={}x{}",
        cap(DriverCapability::DumbBuffer),
        cap(DriverCapability::Prime),
        cap(DriverCapability::AddFB2Modifiers),
        cap(DriverCapability::ASyncPageFlip),
        cap(DriverCapability::CursorWidth),
        cap(DriverCapability::CursorHeight),
    );
    let atomic = card
        .set_client_capability(ClientCapability::Atomic, true)
        .is_ok();
    let universal = card
        .set_client_capability(ClientCapability::UniversalPlanes, true)
        .is_ok();
    println!("client caps: atomic={atomic} universal-planes={universal}");
    let Ok(res) = card.resource_handles() else {
        println!("no KMS resources (a render-only node?)");
        return;
    };
    for &handle in res.connectors() {
        let Ok(info) = card.get_connector(handle, true) else {
            continue;
        };
        let props = property_names(card, handle);
        let interesting: Vec<&str> = [
            "EDID",
            "HDR_OUTPUT_METADATA",
            "Colorspace",
            "max bpc",
            "vrr_capable",
            "non-desktop",
        ]
        .into_iter()
        .filter(|p| props.iter().any(|n| n == p))
        .collect();
        println!(
            "connector {} ({:?}) {:?} {}mm, properties: {}",
            connector_name(&info),
            u32::from(handle),
            info.state(),
            info.size().map_or("?".into(), |(w, h)| format!("{w}x{h}")),
            interesting.join(", ")
        );
        for m in info.modes() {
            let (w, h) = m.size();
            let preferred = if m.mode_type().contains(ModeTypeFlags::PREFERRED) {
                " preferred"
            } else {
                ""
            };
            println!(
                "  mode {w}x{h} @ {} mHz ({} Hz nominal){preferred}",
                refresh_mhz(m),
                m.vrefresh()
            );
        }
    }
    let Ok(planes) = card.plane_handles() else {
        return;
    };
    for plane in planes {
        let Ok(info) = card.get_plane(plane) else {
            continue;
        };
        let formats = info.formats();
        let has = |f: DrmFourcc| formats.contains(&(f as u32));
        let kind = plane_type(card, plane);
        println!(
            "plane {} type={kind} crtcs={:?} formats={} xrgb8888={} xrgb2101010={} fp16={}",
            u32::from(plane),
            res.filter_crtcs(info.possible_crtcs())
                .iter()
                .map(|c| u32::from(*c))
                .collect::<Vec<_>>(),
            formats.len(),
            has(DrmFourcc::Xrgb8888),
            has(DrmFourcc::Xrgb2101010),
            has(DrmFourcc::Abgr16161616f),
        );
    }
}

fn property_names<T: ResourceHandle>(card: &Card, handle: T) -> Vec<String> {
    card.get_properties(handle)
        .and_then(|set| set.as_hashmap(card))
        .map(|map| map.into_keys().collect())
        .unwrap_or_default()
}

/// A plane's `type` property: 0 overlay, 1 primary, 2 cursor (needs the universal-planes cap).
fn plane_type(card: &Card, plane: drm::control::plane::Handle) -> &'static str {
    let Ok(set) = card.get_properties(plane) else {
        return "?";
    };
    let (handles, values) = set.as_props_and_values();
    for (h, v) in handles.iter().zip(values) {
        if card
            .get_property(*h)
            .is_ok_and(|p| p.name().to_bytes() == b"type")
        {
            return match v {
                0 => "overlay",
                1 => "primary",
                2 => "cursor",
                _ => "?",
            };
        }
    }
    "?"
}
