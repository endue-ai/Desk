// The example's scene: a gradient and a soft triangle that turns, drawn by one full-screen
// triangle. Colours are premultiplied, as the desk composites them.

struct Scene {
    angle: f32,
    aspect: f32,
    hue: f32,
    _pad: f32,
};

@group(0) @binding(0) var<uniform> scene: Scene;

struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> Out {
    let x = f32((index << 1u) & 2u);
    let y = f32(index & 2u);
    var out: Out;
    out.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, y);
    return out;
}

// The signed distance to an equilateral triangle of size r around the origin.
fn triangle(p_in: vec2<f32>, r: f32) -> f32 {
    let k = sqrt(3.0);
    var p = vec2<f32>(abs(p_in.x) - r, p_in.y + r / k);
    if (p.x + k * p.y > 0.0) {
        p = vec2<f32>(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    }
    p.x = p.x - clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

fn tint(h: f32) -> vec3<f32> {
    return 0.5 + 0.5 * cos(6.28318 * (h + vec3<f32>(0.0, 0.33, 0.67)));
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
    let top = vec3<f32>(0.09, 0.10, 0.16);
    let bottom = vec3<f32>(0.16, 0.10, 0.22);
    var colour = mix(top, bottom, in.uv.y);
    var p = (in.uv - vec2<f32>(0.5, 0.5)) * 2.0;
    p.x = p.x * scene.aspect;
    let c = cos(scene.angle);
    let s = sin(scene.angle);
    let q = vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
    let d = triangle(q, 0.45);
    let shape = tint(scene.hue + scene.angle / 6.28318);
    let glow = exp(-max(d, 0.0) * 9.0) * 0.45;
    colour = mix(colour + shape * glow, shape, smoothstep(0.01, -0.01, d));
    return vec4<f32>(colour, 1.0);
}
