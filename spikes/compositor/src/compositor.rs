//! The spike's compositor: a wgpu-drawn background and one textured quad per surface, composed
//! into an off-screen target (readable back as PNG) and blitted to the window when it can present.

use glam::{Mat4, Vec3};
use std::sync::Arc;
use winit::window::Window;

const TARGET_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct QuadUniform {
    mvp: [[f32; 4]; 4],
    opacity: f32,
    _pad: [f32; 3],
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
struct BackgroundUniform {
    time: f32,
    _pad: [f32; 3],
}

pub struct Quad {
    uniform: wgpu::Buffer,
    bind_group: Option<wgpu::BindGroup>,
    generation: u64,
}

pub struct Compositor {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    pub size: (u32, u32),
    target: wgpu::Texture,
    target_view: wgpu::TextureView,
    background: wgpu::RenderPipeline,
    background_uniform: wgpu::Buffer,
    background_group: wgpu::BindGroup,
    quad_pipeline: wgpu::RenderPipeline,
    quad_layout: wgpu::BindGroupLayout,
    blit_pipeline: Option<(wgpu::RenderPipeline, wgpu::BindGroup)>,
    sampler: wgpu::Sampler,
    pub quads: Vec<Quad>,
    window: Option<(
        Arc<Window>,
        wgpu::Surface<'static>,
        wgpu::SurfaceConfiguration,
    )>,
    pub presented: u64,
    pub composed: u64,
}

impl Compositor {
    pub fn new(size: (u32, u32)) -> Self {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            #[cfg(target_os = "macos")]
            backends: wgpu::Backends::METAL,
            #[cfg(target_os = "windows")]
            backends: wgpu::Backends::DX12,
            #[cfg(target_os = "linux")]
            backends: wgpu::Backends::VULKAN,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        }))
        .expect("a GPU adapter");
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("desk-spike"),
            #[cfg(target_os = "linux")]
            required_features: wgpu::Features::VULKAN_EXTERNAL_MEMORY_DMA_BUF,
            ..Default::default()
        }))
        .expect("a GPU device");
        let (target, target_view) = make_target(&device, size);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("spike shaders"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()),
        });
        let uniform_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let texture_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                multisampled: false,
                view_dimension: wgpu::TextureViewDimension::D2,
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
            },
            count: None,
        };
        let sampler_entry = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        };

        let background_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("background"),
            entries: &[uniform_entry(0)],
        });
        let quad_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("quad"),
            entries: &[uniform_entry(0), texture_entry(1), sampler_entry(2)],
        });
        let background = pipeline(
            &device,
            &shader,
            &background_layout,
            "vs_background",
            "fs_background",
            TARGET_FORMAT,
        );
        let quad_pipeline = pipeline(
            &device,
            &shader,
            &quad_layout,
            "vs_quad",
            "fs_quad",
            TARGET_FORMAT,
        );
        let background_uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("background uniform"),
            size: std::mem::size_of::<BackgroundUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let background_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("background"),
            layout: &background_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: background_uniform.as_entire_binding(),
            }],
        });

        Compositor {
            device,
            queue,
            instance,
            adapter,
            size,
            target,
            target_view,
            background,
            background_uniform,
            background_group,
            quad_pipeline,
            quad_layout,
            blit_pipeline: None,
            sampler,
            quads: vec![],
            window: None,
            presented: 0,
            composed: 0,
        }
    }

    pub fn adapter_name(&self) -> String {
        let info = self.adapter.get_info();
        format!("{} ({:?})", info.name, info.backend)
    }

    /// Present to `window` from now on (best effort: a locked screen never hands out a drawable).
    pub fn attach_window(&mut self, window: Arc<Window>) {
        let surface = self
            .instance
            .create_surface(window.clone())
            .expect("a window surface");
        let size = window.inner_size();
        let caps = surface.get_capabilities(&self.adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            color_space: wgpu::SurfaceColorSpace::Auto,
        };
        surface.configure(&self.device, &config);
        let shader = self
            .device
            .create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("blit"),
                source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()),
            });
        let blit = pipeline(
            &self.device,
            &shader,
            &self.quad_layout,
            "vs_blit",
            "fs_quad",
            format,
        );
        let uniform = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("blit uniform"),
            size: std::mem::size_of::<QuadUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(
            &uniform,
            0,
            bytemuck::bytes_of(&QuadUniform {
                mvp: Mat4::IDENTITY.to_cols_array_2d(),
                opacity: 1.0,
                _pad: [0.0; 3],
            }),
        );
        let group = self.quad_bind_group(&uniform, &self.target_view);
        self.blit_pipeline = Some((blit, group));
        self.window = Some((window, surface, config));
    }

    pub fn resize_window(&mut self, width: u32, height: u32) {
        if let Some((_, surface, config)) = self.window.as_mut() {
            config.width = width.max(1);
            config.height = height.max(1);
            surface.configure(&self.device, config);
        }
    }

    fn quad_bind_group(&self, uniform: &wgpu::Buffer, view: &wgpu::TextureView) -> wgpu::BindGroup {
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("quad"),
            layout: &self.quad_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    pub fn ensure_quads(&mut self, count: usize) {
        while self.quads.len() < count {
            let uniform = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("quad uniform"),
                size: std::mem::size_of::<QuadUniform>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.quads.push(Quad {
                uniform,
                bind_group: None,
                generation: 0,
            });
        }
    }

    /// Point quad `index` at a new texture when its generation moved.
    pub fn update_texture(&mut self, index: usize, generation: u64, texture: &wgpu::Texture) {
        if self.quads[index].generation == generation && self.quads[index].bind_group.is_some() {
            return;
        }
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let group = self.quad_bind_group(&self.quads[index].uniform, &view);
        let quad = &mut self.quads[index];
        quad.bind_group = Some(group);
        quad.generation = generation;
    }

    /// Lay the quads out in a grid, each tilted `tilt` degrees about Y, seen through a camera
    /// whose z = 0 plane maps one unit to one pixel.
    pub fn layout(&self, count: usize, view: (u32, u32), tilt: f32, time: f32) -> Vec<Mat4> {
        let (w, h) = (self.size.0 as f32, self.size.1 as f32);
        let fov = 40f32.to_radians();
        let distance = (h / 2.0) / (fov / 2.0).tan();
        let projection = Mat4::perspective_rh(fov, w / h, 1.0, distance * 4.0);
        let camera = Mat4::look_at_rh(Vec3::new(0.0, 0.0, distance), Vec3::ZERO, Vec3::Y);
        let columns = (count as f32).sqrt().ceil().max(1.0) as usize;
        let rows = count.div_ceil(columns).max(1);
        let cell_w = w / columns as f32;
        let cell_h = h / rows as f32;
        let aspect = view.0 as f32 / view.1 as f32;
        let quad_w = (cell_w * 0.86).min(cell_h * 0.86 * aspect);
        let quad_h = quad_w / aspect;
        (0..count)
            .map(|i| {
                let (col, row) = (i % columns, i / columns);
                let cx = -w / 2.0 + cell_w * (col as f32 + 0.5);
                let cy = h / 2.0 - cell_h * (row as f32 + 0.5);
                let wobble = (time * 0.6 + i as f32).sin() * 3.0;
                let model = Mat4::from_translation(Vec3::new(cx, cy, 0.0))
                    * Mat4::from_rotation_y((tilt + wobble).to_radians())
                    * Mat4::from_scale(Vec3::new(quad_w, quad_h, 1.0));
                projection * camera * model
            })
            .collect()
    }

    /// Compose one frame into the target and present it to the window if it can.
    pub fn render(&mut self, transforms: &[Mat4], time: f32) {
        self.queue.write_buffer(
            &self.background_uniform,
            0,
            bytemuck::bytes_of(&BackgroundUniform {
                time,
                _pad: [0.0; 3],
            }),
        );
        for (quad, mvp) in self.quads.iter().zip(transforms) {
            let uniform = QuadUniform {
                mvp: mvp.to_cols_array_2d(),
                opacity: 1.0,
                _pad: [0.0; 3],
            };
            self.queue
                .write_buffer(&quad.uniform, 0, bytemuck::bytes_of(&uniform));
        }
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("compose"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("compose"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target_view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.background);
            pass.set_bind_group(0, &self.background_group, &[]);
            pass.draw(0..3, 0..1);
            pass.set_pipeline(&self.quad_pipeline);
            for quad in &self.quads {
                if let Some(group) = &quad.bind_group {
                    pass.set_bind_group(0, group, &[]);
                    pass.draw(0..6, 0..1);
                }
            }
        }
        self.queue.submit([encoder.finish()]);
        self.composed += 1;
        self.present();
        // Reclaim finished submissions (staging buffers, dropped textures) every frame.
        let _ = self.device.poll(wgpu::PollType::Poll);
    }

    fn present(&mut self) {
        let (Some((window, surface, _)), Some((blit, group))) =
            (self.window.as_ref(), self.blit_pipeline.as_ref())
        else {
            return;
        };
        let frame = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            _ => return,
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("blit"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("blit"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(blit);
            pass.set_bind_group(0, group, &[]);
            pass.draw(0..6, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        window.pre_present_notify();
        self.queue.present(frame);
        self.presented += 1;
    }

    /// Read the composed frame back and write it as an RGBA PNG.
    pub fn capture(&self, path: &str) -> std::io::Result<()> {
        let (w, h) = self.size;
        let padded = (w * 4).div_ceil(256) * 256;
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("capture"),
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("capture"),
            });
        encoder.copy_texture_to_buffer(
            self.target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
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
        let slice = buffer.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = self.device.poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        });
        let data = slice
            .get_mapped_range()
            .map_err(|e| std::io::Error::other(format!("{e:?}")))?;
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for row in 0..h {
            let start = (row * padded) as usize;
            for px in data[start..start + (w * 4) as usize].chunks_exact(4) {
                rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
        }
        drop(data);
        buffer.unmap();
        let file = std::fs::File::create(path)?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(std::io::Error::other)?;
        writer
            .write_image_data(&rgba)
            .map_err(std::io::Error::other)?;
        Ok(())
    }
}

fn make_target(device: &wgpu::Device, size: (u32, u32)) -> (wgpu::Texture, wgpu::TextureView) {
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("composed frame"),
        size: wgpu::Extent3d {
            width: size.0,
            height: size.1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    (target, view)
}

fn pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layout: &wgpu::BindGroupLayout,
    vertex: &str,
    fragment: &str,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(vertex),
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(vertex),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some(vertex),
            buffers: &[],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(fragment),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        multiview_mask: None,
        cache: None,
    })
}
