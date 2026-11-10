//! The three render pipelines and their bind group layouts: group 0 holds the item's uniform block
//! (one buffer, dynamic offsets), group 1 a surface's texture and sampler, or the glyph atlas's two
//! pages and sampler; glyphs come in as instances.

use crate::draw_list::ItemUniform;
use crate::text::GLYPH_SIZE;

pub(crate) struct Pipelines {
    pub shape: wgpu::RenderPipeline,
    pub surface: wgpu::RenderPipeline,
    pub glyph: wgpu::RenderPipeline,
    pub items: wgpu::BindGroupLayout,
    pub texture: wgpu::BindGroupLayout,
    pub atlas: wgpu::BindGroupLayout,
    pub sampler: wgpu::Sampler,
}

impl Pipelines {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Pipelines {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("desk-compositor"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders.wgsl").into()),
        });
        let items = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("desk-compositor items"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: true,
                    min_binding_size: wgpu::BufferSize::new(ITEM_SIZE),
                },
                count: None,
            }],
        });
        let texture = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("desk-compositor texture"),
            entries: &[texture_entry(0), sampler_entry(1)],
        });
        let atlas = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("desk-compositor atlas"),
            entries: &[texture_entry(0), texture_entry(1), sampler_entry(2)],
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("desk-compositor surfaces"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let shape = pipeline(
            device,
            &shader,
            &[&items],
            ("vs_item", "fs_shape"),
            &[],
            format,
        );
        let surface = pipeline(
            device,
            &shader,
            &[&items, &texture],
            ("vs_item", "fs_surface"),
            &[],
            format,
        );
        let glyphs = [Some(wgpu::VertexBufferLayout {
            array_stride: GLYPH_SIZE,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &wgpu::vertex_attr_array![
                0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Uint32x4
            ],
        })];
        let glyph = pipeline(
            device,
            &shader,
            &[&items, &atlas],
            ("vs_glyph", "fs_glyph"),
            &glyphs,
            format,
        );
        Pipelines {
            shape,
            surface,
            glyph,
            items,
            texture,
            atlas,
            sampler,
        }
    }

    /// The bind group a registered texture is drawn with.
    pub fn texture_group(
        &self,
        device: &wgpu::Device,
        view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("desk-compositor texture"),
            layout: &self.texture,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    /// The bind group the glyph atlas is drawn with: its mask page and its colour page.
    pub fn atlas_group(
        &self,
        device: &wgpu::Device,
        mask: &wgpu::TextureView,
        color: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("desk-compositor atlas"),
            layout: &self.atlas,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(mask),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(color),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    /// The bind group over the item buffer (bound at a dynamic offset per item).
    pub fn items_group(&self, device: &wgpu::Device, buffer: &wgpu::Buffer) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("desk-compositor items"),
            layout: &self.items,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                    buffer,
                    offset: 0,
                    size: wgpu::BufferSize::new(ITEM_SIZE),
                }),
            }],
        })
    }
}

/// Bytes in one item's uniform block.
pub(crate) const ITEM_SIZE: u64 = std::mem::size_of::<ItemUniform>() as u64;

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            multisampled: false,
            view_dimension: wgpu::TextureViewDimension::D2,
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
        },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}

fn pipeline(
    device: &wgpu::Device,
    shader: &wgpu::ShaderModule,
    layouts: &[&wgpu::BindGroupLayout],
    (vertex, fragment): (&str, &str),
    buffers: &[Option<wgpu::VertexBufferLayout<'_>>],
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let layouts: Vec<Option<&wgpu::BindGroupLayout>> = layouts.iter().copied().map(Some).collect();
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(fragment),
        bind_group_layouts: &layouts,
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(fragment),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some(vertex),
            buffers,
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(fragment),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
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
