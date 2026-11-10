//! Our own KMS: wgpu renders into an off-screen texture on whatever adapter the machine has, the
//! frame is copied into the back one of two XRGB8888 dumb buffers, and we flip with
//! `drmModePageFlip(..., DRM_MODE_PAGE_FLIP_EVENT)` and wait for the event on the card's fd.
//! The first frame (and the first after a VT switch back) is a full modeset (`drmModeSetCrtc`).
//! Legacy KMS on purpose: every driver has it; atomic is the production path.

use super::Present;
use crate::kms::{Card, Output};
use drm::buffer::{Buffer as _, DrmFourcc};
use drm::control::{
    Device as ControlDevice, Event, PageFlipFlags, crtc, dumbbuffer::DumbBuffer, framebuffer,
};
use std::os::fd::{AsFd, BorrowedFd};
use std::rc::Rc;

/// The texture format whose bytes are XRGB8888's in memory (little endian: B, G, R, X).
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;

struct Buffer {
    dumb: DumbBuffer,
    fb: framebuffer::Handle,
}

pub struct Dumb {
    card: Rc<Card>,
    output: Output,
    device: wgpu::Device,
    queue: wgpu::Queue,
    adapter: wgpu::AdapterInfo,
    target: desk_compositor::headless::Target,
    readback: wgpu::Buffer,
    padded: u32,
    buffers: Vec<Buffer>,
    /// The buffer on screen; the other one is drawn next.
    front: usize,
    flip_pending: bool,
    modeset: bool,
    paused: bool,
    saved: Option<crtc::Info>,
    flips: u64,
}

impl Dumb {
    pub fn new(card: Rc<Card>, output: &Output) -> Result<Dumb, String> {
        let gpu = desk_compositor::headless::headless_device().map_err(|e| e.to_string())?;
        let size = output.size();
        let target = desk_compositor::headless::Target::new(&gpu.device, size, FORMAT);
        let padded = (size.0 * 4).div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT)
            * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let readback = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("desk-kms readback"),
            size: u64::from(padded * size.1),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut buffers = vec![];
        for _ in 0..2 {
            let dumb = card
                .create_dumb_buffer(size, DrmFourcc::Xrgb8888, 32)
                .map_err(|e| format!("dumb buffer: {e} (the driver has no dumb buffers?)"))?;
            let fb = card
                .add_framebuffer(&dumb, 24, 32)
                .map_err(|e| format!("framebuffer: {e}"))?;
            buffers.push(Buffer { dumb, fb });
        }
        let saved = card.get_crtc(output.crtc).ok();
        Ok(Dumb {
            card,
            output: output.clone(),
            device: gpu.device,
            queue: gpu.queue,
            adapter: gpu.adapter,
            target,
            readback,
            padded,
            buffers,
            front: 1,
            flip_pending: false,
            modeset: true,
            paused: false,
            saved,
            flips: 0,
        })
    }

    /// Copy the composed frame into dumb buffer `index`, row by row (pitches differ).
    fn copy_into(&mut self, index: usize) -> Result<(), String> {
        let (w, h) = self.target.size;
        let mut encoder = self.device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            self.target.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &self.readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(self.padded),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);
        let slice = self.readback.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        self.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| format!("readback: {e}"))?;
        {
            let data = slice
                .get_mapped_range()
                .map_err(|e| format!("readback map: {e:?}"))?;
            let buffer = &mut self.buffers[index];
            let pitch = buffer.dumb.pitch() as usize;
            let mut map = self
                .card
                .map_dumb_buffer(&mut buffer.dumb)
                .map_err(|e| format!("map dumb: {e}"))?;
            let row = (w * 4) as usize;
            for y in 0..h as usize {
                let from = &data[y * self.padded as usize..][..row];
                map[y * pitch..][..row].copy_from_slice(from);
            }
        }
        self.readback.unmap();
        Ok(())
    }
}

impl Present for Dumb {
    fn device(&self) -> &wgpu::Device {
        &self.device
    }
    fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }
    fn adapter(&self) -> wgpu::AdapterInfo {
        self.adapter.clone()
    }
    fn format(&self) -> wgpu::TextureFormat {
        FORMAT
    }
    fn size(&self) -> (u32, u32) {
        self.target.size
    }
    fn describe(&self) -> String {
        format!(
            "dumb (2 XRGB8888 dumb buffers, legacy page flips on CRTC {:?})",
            self.output.crtc
        )
    }
    fn ready(&self) -> bool {
        !self.paused && !self.flip_pending
    }

    fn frame(&mut self, draw: &mut dyn FnMut(&wgpu::TextureView) -> bool) -> Result<(), String> {
        let view = self.target.view.clone();
        if !draw(&view) && !self.modeset {
            return Ok(());
        }
        let back = 1 - self.front;
        self.copy_into(back)?;
        let fb = self.buffers[back].fb;
        if self.modeset {
            let o = &self.output;
            self.card
                .set_crtc(o.crtc, Some(fb), (0, 0), &[o.connector], Some(o.mode))
                .map_err(|e| format!("modeset {}: {e} (not DRM master?)", o.name))?;
            self.modeset = false;
            self.front = back;
            return Ok(());
        }
        self.card
            .page_flip(self.output.crtc, fb, PageFlipFlags::EVENT, None)
            .map_err(|e| format!("page flip: {e}"))?;
        self.flip_pending = true;
        self.front = back;
        Ok(())
    }

    fn flip_fd(&self) -> Option<BorrowedFd<'_>> {
        Some(self.card.as_fd())
    }

    fn flipped(&mut self) {
        let Ok(events) = self.card.receive_events() else {
            return;
        };
        for event in events {
            if let Event::PageFlip(flip) = event
                && flip.crtc == self.output.crtc
            {
                self.flip_pending = false;
                self.flips += 1;
            }
        }
    }

    fn pause(&mut self) {
        self.paused = true;
        // A flip queued before master went away completes or is dropped; never wait for it.
        self.flip_pending = false;
    }

    fn resume(&mut self) -> Result<(), String> {
        self.paused = false;
        self.modeset = true;
        Ok(())
    }

    fn flips(&self) -> u64 {
        self.flips
    }
}

impl Drop for Dumb {
    fn drop(&mut self) {
        // Give the console back what it had, as weston and sway do on exit.
        if !self.paused
            && let Some(saved) = &self.saved
        {
            let _ = self.card.set_crtc(
                saved.handle(),
                saved.framebuffer(),
                saved.position(),
                &[self.output.connector],
                saved.mode(),
            );
        }
        for buffer in self.buffers.drain(..) {
            let _ = self.card.destroy_framebuffer(buffer.fb);
            let _ = self.card.destroy_dumb_buffer(buffer.dumb);
        }
    }
}
