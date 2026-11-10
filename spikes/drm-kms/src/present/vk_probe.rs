//! What the Vulkan driver says about our connector before wgpu takes it: whether it has
//! `VK_EXT_acquire_drm_display`, which physical device the card is, the connector's Vulkan modes
//! (wgpu matches width, height and millihertz exactly) and which display planes can show it.
//! `get_drm_display` only names the display; acquiring it is left to wgpu (a second acquire fails).

use crate::kms::Card;
use ash::vk;
use std::os::fd::{AsFd, AsRawFd};

#[derive(Debug, Default)]
pub struct Probe {
    pub extension: bool,
    pub device: Option<String>,
    /// (width, height, refresh in mHz) of the connector's Vulkan display modes.
    pub modes: Vec<(u32, u32, u32)>,
    /// Display plane indices whose supported displays include the connector's.
    pub planes: Vec<u32>,
    pub plane_count: usize,
}

pub fn probe(instance: &wgpu::Instance, card: &Card, connector: u32) -> Result<Probe, String> {
    // SAFETY: we only read through the instance wgpu created; nothing outlives this call.
    let hal = unsafe { instance.as_hal::<wgpu::hal::api::Vulkan>() }
        .ok_or("no Vulkan instance (is a Vulkan driver installed?)")?;
    let shared = hal.shared_instance();
    let (entry, raw) = (shared.entry(), shared.raw_instance());
    let mut probe = Probe {
        extension: shared
            .extensions()
            .contains(&ash::ext::acquire_drm_display::NAME),
        ..Probe::default()
    };
    if !probe.extension {
        return Ok(probe);
    }
    let rdev = rustix::fs::fstat(card)
        .map_err(|e| format!("fstat card: {e}"))?
        .st_rdev;
    // SAFETY: plain queries on a live instance.
    let devices =
        unsafe { raw.enumerate_physical_devices() }.map_err(|e| format!("Vulkan devices: {e}"))?;
    let mut found = None;
    for pdev in devices {
        let mut drm = vk::PhysicalDeviceDrmPropertiesEXT::default();
        let mut props = vk::PhysicalDeviceProperties2::default().push_next(&mut drm);
        unsafe { raw.get_physical_device_properties2(pdev, &mut props) };
        let name = props
            .properties
            .device_name_as_c_str()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let primary = rustix::fs::makedev(drm.primary_major as u32, drm.primary_minor as u32);
        let render = rustix::fs::makedev(drm.render_major as u32, drm.render_minor as u32);
        if (drm.has_primary == vk::TRUE && primary == rdev)
            || (drm.has_render == vk::TRUE && render == rdev)
        {
            found = Some((pdev, name));
            break;
        }
    }
    let Some((pdev, name)) = found else {
        return Ok(probe);
    };
    probe.device = Some(name);
    let acquire = ash::ext::acquire_drm_display::Instance::new(entry, raw);
    let display_fns = ash::khr::display::Instance::new(entry, raw);
    let fd = card.as_fd().as_raw_fd();
    // SAFETY: fd is our open card, connector one of its connector ids.
    let display = unsafe { acquire.get_drm_display(pdev, fd, connector) }
        .map_err(|e| format!("vkGetDrmDisplayEXT: {e}"))?;
    let modes = unsafe { display_fns.get_display_mode_properties(pdev, display) }
        .map_err(|e| format!("display modes: {e}"))?;
    probe.modes = modes
        .iter()
        .map(|m| {
            let p = m.parameters;
            (
                p.visible_region.width,
                p.visible_region.height,
                p.refresh_rate,
            )
        })
        .collect();
    let planes = unsafe { display_fns.get_physical_device_display_plane_properties(pdev) }
        .map_err(|e| format!("display planes: {e}"))?;
    probe.plane_count = planes.len();
    for index in 0..planes.len() as u32 {
        let shown = unsafe { display_fns.get_display_plane_supported_displays(pdev, index) }
            .unwrap_or_default();
        if shown.contains(&display) {
            probe.planes.push(index);
        }
    }
    Ok(probe)
}

pub fn print(probe: &Probe) {
    println!(
        "vulkan: VK_EXT_acquire_drm_display={} device={} planes={} (for this connector: {:?})",
        probe.extension,
        probe.device.as_deref().unwrap_or("none matches the card"),
        probe.plane_count,
        probe.planes
    );
    for (w, h, mhz) in &probe.modes {
        println!("  vulkan mode {w}x{h} @ {mhz} mHz");
    }
}
