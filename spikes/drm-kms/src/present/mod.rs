//! Getting composed frames onto the KMS output. Two paths:
//!
//! - `vk_display`: wgpu 30's `SurfaceTargetUnsafe::Drm` (feature `drm`). wgpu-hal acquires the
//!   connector through `VK_EXT_acquire_drm_display` on our master fd and makes a
//!   `VK_KHR_display` plane surface; the Vulkan driver's WSI does the modeset and the page flips
//!   inside `vkQueuePresentKHR` (FIFO: one flip per vblank). Zero copies, but the driver owns
//!   KMS: no atomic properties, no planes of ours, no HDR metadata.
//! - `dumb`: wgpu renders off-screen on any adapter (lavapipe and llvmpipe included), the frame is
//!   read back into one of two KMS dumb buffers, and we modeset and page-flip ourselves with
//!   drm-rs. Works on every KMS driver (virtio-gpu, simpledrm), one CPU copy per frame.
//!
//! The production path is neither: GBM buffers with scanout modifiers imported into Vulkan as
//! DMA-BUFs, rendered by wgpu, committed with atomic KMS (see README).

pub mod dumb;
pub mod vk_display;
pub mod vk_probe;

use std::os::fd::BorrowedFd;

pub trait Present {
    fn device(&self) -> &wgpu::Device;
    fn queue(&self) -> &wgpu::Queue;
    fn adapter(&self) -> wgpu::AdapterInfo;
    fn format(&self) -> wgpu::TextureFormat;
    fn size(&self) -> (u32, u32);
    fn describe(&self) -> String;
    /// Whether a frame can be queued now (no flip of ours is still pending).
    fn ready(&self) -> bool;
    /// Draw a frame with `draw` (it renders into the view and says whether it drew) and queue it
    /// for the next vblank. The vk-display path blocks here while every image is queued.
    fn frame(&mut self, draw: &mut dyn FnMut(&wgpu::TextureView) -> bool) -> Result<(), String>;
    /// An fd that becomes readable when a flip completed, for the main loop's poll.
    fn flip_fd(&self) -> Option<BorrowedFd<'_>>;
    /// The flip fd is readable: read its events.
    fn flipped(&mut self);
    /// The session left the foreground: no KMS calls until `resume`.
    fn pause(&mut self);
    /// Back in the foreground: someone else may have changed the CRTC, so modeset again.
    fn resume(&mut self) -> Result<(), String>;
    /// Flips completed since the start (dumb) or frames presented (vk-display).
    fn flips(&self) -> u64;
}
