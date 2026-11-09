// Background: one full-screen triangle with a slowly moving gradient, drawn by us (not by CEF).
struct Background { time: f32 };
@group(0) @binding(0) var<uniform> bg: Background;

struct BgOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };

@vertex fn vs_background(@builtin(vertex_index) i: u32) -> BgOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BgOut;
  o.position = vec4f(p[i], 0.0, 1.0);
  o.uv = p[i] * 0.5 + 0.5;
  return o;
}

@fragment fn fs_background(v: BgOut) -> @location(0) vec4f {
  let t = bg.time * 0.15;
  let a = vec3f(0.05, 0.07, 0.16);
  let b = vec3f(0.28, 0.10, 0.36);
  let wave = 0.5 + 0.5 * sin(v.uv.x * 3.0 + t * 2.0) * cos(v.uv.y * 2.0 - t);
  let rings = 0.04 * sin(length(v.uv - vec2f(0.5)) * 40.0 - bg.time * 2.0);
  return vec4f(mix(a, b, wave) + rings, 1.0);
}

// Quads: a unit square (-0.5..0.5) placed by the surface's model-view-projection matrix.
struct Quad { mvp: mat4x4f, opacity: f32 };
@group(0) @binding(0) var<uniform> quad: Quad;
@group(0) @binding(1) var surface_texture: texture_2d<f32>;
@group(0) @binding(2) var surface_sampler: sampler;

struct QuadOut { @builtin(position) position: vec4f, @location(0) uv: vec2f };

fn corner(i: u32) -> vec2f {
  var c = array<vec2f, 6>(
    vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
    vec2f(-0.5, -0.5), vec2f(0.5, 0.5), vec2f(-0.5, 0.5));
  return c[i];
}

@vertex fn vs_quad(@builtin(vertex_index) i: u32) -> QuadOut {
  let c = corner(i);
  var o: QuadOut;
  o.position = quad.mvp * vec4f(c, 0.0, 1.0);
  o.uv = vec2f(c.x + 0.5, 0.5 - c.y);
  return o;
}

// Blit: the composed frame to the window, full screen.
@vertex fn vs_blit(@builtin(vertex_index) i: u32) -> QuadOut {
  let c = corner(i);
  var o: QuadOut;
  o.position = vec4f(c * 2.0, 0.0, 1.0);
  o.uv = vec2f(c.x + 0.5, 0.5 - c.y);
  return o;
}

@fragment fn fs_quad(v: QuadOut) -> @location(0) vec4f {
  let colour = textureSample(surface_texture, surface_sampler, v.uv);
  return vec4f(colour.rgb, colour.a * quad.opacity);
}
