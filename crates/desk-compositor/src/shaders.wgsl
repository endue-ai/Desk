// desk-compositor: one vertex stage for every item, a fragment stage for shapes (rectangles,
// shadows, the gradient wallpaper) and one for textured surfaces. Output is premultiplied alpha.

struct Item {
  mvp: mat4x4f,
  clip_from_local: mat4x4f,
  geometry: vec4f,
  shape: vec4f,
  clip: vec4f,
  fill: vec4f,
  stroke: vec4f,
  uv: vec4f,
  // radius, stroke width, opacity, shadow sigma
  params: vec4f,
  mode: vec4u,
};

const MODE_SHAPE: u32 = 0u;
const MODE_SHADOW: u32 = 1u;
const MODE_GRADIENT: u32 = 2u;

@group(0) @binding(0) var<uniform> item: Item;
@group(1) @binding(0) var surface_texture: texture_2d<f32>;
@group(1) @binding(1) var surface_sampler: sampler;

struct Varyings {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) clip_space: vec2f,
};

@vertex fn vs_item(@builtin(vertex_index) i: u32) -> Varyings {
  var corners = array<vec2f, 6>(
    vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let local = mix(item.geometry.xy, item.geometry.zw, corners[i]);
  var out: Varyings;
  out.position = item.mvp * vec4f(local, 0.0, 1.0);
  out.local = local;
  out.clip_space = (item.clip_from_local * vec4f(local, 0.0, 1.0)).xy;
  return out;
}

// Signed distance from p to the rounded box (negative inside).
fn rounded_box(p: vec2f, shape: vec4f, radius: f32) -> f32 {
  let center = (shape.xy + shape.zw) * 0.5;
  let half = max((shape.zw - shape.xy) * 0.5, vec2f(0.0));
  let r = min(radius, min(half.x, half.y));
  let q = abs(p - center) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// One screen pixel measured in the units of `v`.
fn pixel_size(v: vec2f) -> f32 {
  return max(length(vec2f(length(dpdx(v)), length(dpdy(v)))) * 0.70710678, 1e-5);
}

// Coverage of the clip rectangle, antialiased.
fn clip_coverage(p: vec2f, px: f32) -> f32 {
  let outside = max(item.clip.xy - p, p - item.clip.zw);
  return clamp(0.5 - max(outside.x, outside.y) / px, 0.0, 1.0);
}

// Abramowitz and Stegun 7.1.27, enough for a shadow's edge.
fn erf(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 + (0.278393 + (0.230389 + 0.078108 * a * a) * a) * a;
  let t2 = t * t;
  return sign(x) * (1.0 - 1.0 / (t2 * t2));
}

fn premultiply(c: vec4f) -> vec4f {
  return vec4f(c.rgb * c.a, c.a);
}

@fragment fn fs_shape(v: Varyings) -> @location(0) vec4f {
  let px = pixel_size(v.local);
  let clip = clip_coverage(v.clip_space, pixel_size(v.clip_space));
  let opacity = item.params.z * clip;
  let d = rounded_box(v.local, item.shape, item.params.x);
  if (item.mode.x == MODE_SHADOW) {
    let sigma = item.params.w;
    var alpha = clamp(0.5 - d / px, 0.0, 1.0);
    if (sigma > 0.0) {
      alpha = 0.5 - 0.5 * erf(d / (sigma * 1.41421356));
    }
    return premultiply(item.fill) * alpha * opacity;
  }
  if (item.mode.x == MODE_GRADIENT) {
    let t = clamp((v.local.y - item.shape.y) / max(item.shape.w - item.shape.y, 1e-5), 0.0, 1.0);
    return mix(premultiply(item.fill), premultiply(item.stroke), t) * opacity;
  }
  let coverage = clamp(0.5 - d / px, 0.0, 1.0);
  var colour = premultiply(item.fill);
  let stroke_width = item.params.y;
  if (stroke_width > 0.0) {
    let band = clamp(0.5 + (d + stroke_width) / px, 0.0, 1.0);
    colour = mix(colour, premultiply(item.stroke), band);
  }
  return colour * coverage * opacity;
}

@fragment fn fs_surface(v: Varyings) -> @location(0) vec4f {
  let px = pixel_size(v.local);
  let clip = clip_coverage(v.clip_space, pixel_size(v.clip_space));
  let size = max(item.shape.zw - item.shape.xy, vec2f(1e-5));
  let along = (v.local - item.shape.xy) / size;
  let uv = mix(item.uv.xy, item.uv.zw, along);
  let texel = textureSample(surface_texture, surface_sampler, uv);
  let d = rounded_box(v.local, item.shape, item.params.x);
  let coverage = clamp(0.5 - d / px, 0.0, 1.0);
  return texel * coverage * item.params.z * clip;
}
