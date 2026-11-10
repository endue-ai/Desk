//! The wgpu scene: one pipeline that draws a gradient, a turning triangle and the two parts under it
//! with the focused one's ring (`scene.wgsl`) into whatever texture the frame is.

use std::io;

use bytemuck::{Pod, Zeroable};

/// The scene's uniforms, as `scene.wgsl` reads them.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniforms {
    angle: f32,
    aspect: f32,
    hue: f32,
    ring: f32,
    size: [f32; 2],
    paused: f32,
    _pad: f32,
    parts: [[f32; 4]; 2],
}

/// What one frame shows.
pub struct Look {
    /// How far the triangle turned, in radians, and its hue.
    pub angle: f32,
    pub hue: f32,
    /// Each part's box in the texture's pixels: x, y, width, height (`parts.rs`).
    pub parts: [[f32; 4]; 2],
    /// The part whose focus ring shows, -1 for none.
    pub ring: f32,
    /// 1 while the triangle stands still.
    pub paused: f32,
}

/// The GPU and the scene's pipeline.
pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    uniforms: wgpu::Buffer,
    group: wgpu::BindGroup,
}

impl Gpu {
    /// The machine's GPU (Metal on macOS) and the pipeline for frames of `format`.
    pub fn new(format: wgpu::TextureFormat) -> io::Result<Gpu> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::PRIMARY,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&Default::default()))
            .map_err(|e| io::Error::other(format!("no GPU: {e}")))?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("plugin-native-wgpu"),
            ..Default::default()
        }))
        .map_err(|e| io::Error::other(format!("no device: {e}")))?;
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene"),
            source: wgpu::ShaderSource::Wgsl(include_str!("scene.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene"),
            size: std::mem::size_of::<Uniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniforms.as_entire_binding(),
            }],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("scene"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });
        Ok(Gpu {
            device,
            queue,
            pipeline,
            uniforms,
            group,
        })
    }

    /// Draw `look` into `target`, of `size` pixels, and wait until the GPU is done: the desk reads
    /// the frame as soon as it is attached.
    pub fn draw(&self, target: &wgpu::Texture, size: (u32, u32), look: &Look) {
        let uniforms = Uniforms {
            angle: look.angle,
            aspect: size.0 as f32 / size.1.max(1) as f32,
            hue: look.hue,
            ring: look.ring,
            size: [size.0 as f32, size.1 as f32],
            paused: look.paused,
            _pad: 0.0,
            parts: look.parts,
        };
        self.queue
            .write_buffer(&self.uniforms, 0, bytemuck::bytes_of(&uniforms));
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = (self.device).create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene"),
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
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit([encoder.finish()]);
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }
}
