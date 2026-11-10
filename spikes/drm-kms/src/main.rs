//! desk-kms: spike for #60. desk-compositor owns a Linux display directly, with no X11 or Wayland
//! underneath: a KMS output (wgpu's Vulkan DRM surface, or our own dumb-buffer page flips), the
//! seat from logind or libseat (VT switching), libinput and xkbcommon for input routed through the
//! compositor's own `InputRouter`, and optionally one CEF windowless browser as a plugin window.
//! Throwaway code: README.md says what it shows, what was verified, and how to run it.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

mod keys;

#[cfg(target_os = "linux")]
#[path = "../../../crates/desk-compositor/examples/shared/mod.rs"]
mod demo;
#[cfg(target_os = "linux")]
mod desk;
#[cfg(target_os = "linux")]
mod input;
#[cfg(target_os = "linux")]
mod kms;
#[cfg(target_os = "linux")]
mod options;
#[cfg(target_os = "linux")]
mod present;
#[cfg(target_os = "linux")]
mod seat;
#[cfg(target_os = "linux")]
mod session;
#[cfg(all(target_os = "linux", feature = "cef"))]
mod web;
#[cfg(all(target_os = "linux", feature = "cef"))]
mod web_input;

use std::process::ExitCode;

#[cfg(not(target_os = "linux"))]
fn main() -> ExitCode {
    eprintln!("desk-kms runs on Linux only: it drives DRM/KMS, libinput and the logind seat");
    ExitCode::FAILURE
}

#[cfg(target_os = "linux")]
fn main() -> ExitCode {
    // CEF starts its renderer, GPU and zygote processes from this binary: they leave here, before
    // anything opens the seat or the card.
    #[cfg(feature = "cef")]
    if let Some(code) = web::subprocess() {
        return code;
    }
    let options = match options::Options::parse() {
        Ok(options) => options,
        Err(text) => {
            eprintln!("{text}");
            return ExitCode::from(2);
        }
    };
    if options.list {
        return list(&options);
    }
    match session::run(options) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("desk-kms: {e}");
            ExitCode::FAILURE
        }
    }
}

/// `--list`: every card, its connectors, modes and planes, what Vulkan says about each connected
/// connector, and the adapters wgpu sees. Opens the cards read-only: no seat, no master.
#[cfg(target_os = "linux")]
fn list(options: &options::Options) -> ExitCode {
    use drm::control::{Device as _, connector};
    let cards = options.device.clone().map_or_else(kms::cards, |d| vec![d]);
    if cards.is_empty() {
        eprintln!("no /dev/dri/card*: no KMS driver is loaded");
        return ExitCode::FAILURE;
    }
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    for path in cards {
        let file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(e) => {
                eprintln!(
                    "{}: {e} (list from the console session, or join the video group)",
                    path.display()
                );
                continue;
            }
        };
        let card = kms::Card(file.into());
        kms::list(&card, &path);
        let Ok(res) = card.resource_handles() else {
            continue;
        };
        for &handle in res.connectors() {
            let Ok(info) = card.get_connector(handle, false) else {
                continue;
            };
            if info.state() != connector::State::Connected {
                continue;
            }
            print!("{}: ", kms::connector_name(&info));
            match present::vk_probe::probe(&instance, &card, handle.into()) {
                Ok(probe) => present::vk_probe::print(&probe),
                Err(e) => println!("vulkan probe failed: {e}"),
            }
        }
    }
    for adapter in pollster::block_on(instance.enumerate_adapters(wgpu::Backends::all())) {
        let info = adapter.get_info();
        let dmabuf = adapter
            .features()
            .contains(wgpu::Features::VULKAN_EXTERNAL_MEMORY_DMA_BUF);
        println!(
            "wgpu adapter: {} ({:?}, {:?}, {} {}), DMA-BUF import {dmabuf}",
            info.name, info.backend, info.device_type, info.driver, info.driver_info
        );
    }
    ExitCode::SUCCESS
}
