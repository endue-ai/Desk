//! The render handler of an off-screen browser: its view's size and scale, and every paint handed to
//! the compositor as an `attach` inside CEF's paint callback (the shared texture is CEF's again when
//! the callback returns). macOS names the IOSurface and the compositor imports it; on Windows and
//! Linux the `cef` crate's importer copies the frame into a texture of the compositor's device first.
//! Software paints (no GPU: CI's path) are uploaded and attached the same way. For input (#56) it
//! says the composition's character boxes (`ime.caret`), whether an editable element has the focus
//! (`ime.enabled`), and hands the drags the page's engine starts to the compositor's broker.

use std::sync::Arc;

use cef::*;
use desk_compositor::Source;
use desk_surface::generated::{SurfaceFormat, SurfaceReleaseWhen};

use super::SurfaceSink;
use super::paint::{self, Painted};
use super::view::SharedView;

wrap_render_handler! {
    pub struct SurfaceRender {
        view: SharedView,
        sink: Arc<dyn SurfaceSink>,
    }

    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                let (width, height) = self.view.lock().size;
                *rect = Rect { x: 0, y: 0, width: width.max(1) as i32, height: height.max(1) as i32 };
            }
        }

        fn screen_info(&self, _browser: Option<&mut Browser>, info: Option<&mut ScreenInfo>) -> ::std::os::raw::c_int {
            let Some(info) = info else { return 0 };
            let view = self.view.lock();
            info.device_scale_factor = view.scale;
            let screen = Rect { x: 0, y: 0, width: view.size.0 as i32, height: view.size.1 as i32 };
            info.rect = screen.clone();
            info.available_rect = screen;
            1
        }

        fn on_accelerated_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            info: Option<&AcceleratedPaintInfo>,
        ) {
            // Popups (a <select>'s list) are drawn by the page itself once input arrives (#56).
            let (true, Some(info)) = (type_ == PaintElementType::VIEW, info) else { return };
            let Some(painted) = paint::painted(info) else {
                self.failed("CEF painted without a shared texture".into());
                return;
            };
            let (frame, generation, surface) = {
                let mut view = self.view.lock();
                let (frame, generation) = view.next_frame(painted.size);
                (frame, generation, view.surface.clone())
            };
            let damage = paint::damage(dirty_rects, painted.size);
            let damage_px = damage.iter().map(|r| r.width * r.height).sum();
            let attach = paint::attach(&surface, frame, generation, &painted, damage);
            match import(&*self.sink, &attach, info) {
                Ok(_) => {
                    let mut view = self.view.lock();
                    view.counts.paints += 1;
                    view.counts.damage_px = damage_px;
                }
                Err(why) => self.failed(why),
            }
        }

        // The composition's characters, in the view's pixels: the caret for the OS candidate window.
        fn on_ime_composition_range_changed(
            &self,
            _browser: Option<&mut Browser>,
            _selected_range: Option<&Range>,
            character_bounds: Option<&[Rect]>,
        ) {
            let surface = self.view.lock().surface.clone();
            if let Some(caret) = super::routes::caret(&surface, character_bounds.unwrap_or(&[])) {
                self.sink.message(caret);
            }
        }

        // An editable element took the focus (a text mode) or none has it: the OS IME on or off.
        fn on_virtual_keyboard_requested(&self, _browser: Option<&mut Browser>, input_mode: TextInputMode) {
            let surface = self.view.lock().surface.clone();
            self.sink.message(super::routes::enabled(&surface, input_mode));
        }

        // The page's engine starts a drag (a link, a selection, files): the broker takes it as desk
        // data, from this surface, while the press that started it is held.
        fn start_dragging(
            &self,
            _browser: Option<&mut Browser>,
            drag_data: Option<&mut DragData>,
            allowed_ops: DragOperationsMask,
            _x: ::std::os::raw::c_int,
            _y: ::std::os::raw::c_int,
        ) -> ::std::os::raw::c_int {
            let surface = self.view.lock().surface.clone();
            let Some(start) = drag_data.and_then(|d| super::routes::started(&surface, d, allowed_ops)) else {
                return 0;
            };
            self.sink.message(desk_surface::generated::SurfaceMessage::SurfaceDragStart(start));
            1
        }

        // CEF's C signature hands a raw buffer; it holds `width` x `height` BGRA pixels.
        #[allow(clippy::not_unsafe_ptr_arg_deref)]
        fn on_paint(
            &self,
            _browser: Option<&mut Browser>,
            type_: PaintElementType,
            dirty_rects: Option<&[Rect]>,
            buffer: *const u8,
            width: ::std::os::raw::c_int,
            height: ::std::os::raw::c_int,
        ) {
            if type_ != PaintElementType::VIEW || buffer.is_null() || width <= 0 || height <= 0 {
                return;
            }
            let size = (width as u32, height as u32);
            // SAFETY: CEF hands `width * height` BGRA pixels, valid for this call.
            #[allow(unsafe_code)]
            let pixels = unsafe { std::slice::from_raw_parts(buffer, size.0 as usize * size.1 as usize * 4) };
            let (frame, generation, surface) = {
                let mut view = self.view.lock();
                let (frame, generation) = view.next_frame(size);
                view.counts.software_paints += 1;
                (frame, generation, view.surface.clone())
            };
            let (device, queue) = self.sink.device();
            let texture = upload(&device, &queue, size, pixels);
            let painted = Painted {
                id: 0,
                size,
                format: SurfaceFormat::Bgra8,
                handle: paint::software_handle(),
                release: SurfaceReleaseWhen::AfterCopy,
            };
            let attach = paint::attach(&surface, frame, generation, &painted, paint::damage(dirty_rects, size));
            if let Err(why) = self.sink.attach(&attach, Source::Imported(&texture)) {
                self.failed(why.to_string());
            }
        }
    }
}

impl SurfaceRender {
    fn failed(&self, why: String) {
        let mut view = self.view.lock();
        view.counts.import_errors += 1;
        if view.counts.import_errors <= 3 {
            eprintln!(
                "endue Desk: surface {} did not import a frame ({why})",
                view.surface
            );
        }
        view.counts.last_error = Some(why);
    }
}

/// macOS: the compositor imports the IOSurface the attach names.
#[cfg(target_os = "macos")]
fn import(
    sink: &dyn SurfaceSink,
    attach: &desk_surface::generated::SurfaceAttach,
    _info: &AcceleratedPaintInfo,
) -> Result<(), String> {
    sink.attach(attach, Source::Handle)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Windows and Linux: the `cef` crate copies the shared texture into one of the compositor's device.
#[cfg(not(target_os = "macos"))]
#[allow(unsafe_code)]
fn import(
    sink: &dyn SurfaceSink,
    attach: &desk_surface::generated::SurfaceAttach,
    info: &AcceleratedPaintInfo,
) -> Result<(), String> {
    let (device, queue) = sink.device();
    let handle = cef::osr_texture_import::SharedTextureHandle::new(info);
    // SAFETY: inside CEF's paint callback, on a device of the GPU CEF renders with.
    let texture = unsafe { handle.import_texture(&device, &queue) }.map_err(|e| e.to_string())?;
    sink.attach(attach, Source::Imported(&texture))
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// A software paint's pixels in a texture the compositor copies from.
fn upload(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    size: (u32, u32),
    bgra: &[u8],
) -> wgpu::Texture {
    let extent = wgpu::Extent3d {
        width: size.0,
        height: size.1,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("desk-shell software paint"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Bgra8Unorm,
        usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let layout = wgpu::TexelCopyBufferLayout {
        offset: 0,
        bytes_per_row: Some(size.0 * 4),
        rows_per_image: Some(size.1),
    };
    queue.write_texture(texture.as_image_copy(), bgra, layout, extent);
    texture
}
