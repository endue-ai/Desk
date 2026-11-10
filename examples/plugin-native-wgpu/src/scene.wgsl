// The example's scene: a gradient, a soft triangle that turns, and two parts under it (Colour, a
// swatch of the triangle's colour, and Pause, whose bars become a play mark while it stands still),
// the focused one ringed while the surface has the keys; all drawn by one full-screen triangle.
// Colours are premultiplied, as the desk composites them.

struct Scene {
    angle: f32,
    aspect: f32,
    hue: f32,
    // The part whose ring shows, -1 for none.
    ring: f32,
    // The texture's size in pixels.
    size: vec2<f32>,
    paused: f32,
    _pad: f32,
    // Each part's box in pixels: x, y, width, height.
    parts: array<vec4<f32>, 2>,
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

// The signed distance to a box of half size b with corners of radius r, around the origin.
fn rounded(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - b + vec2<f32>(r, r);
    return length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn tint(h: f32) -> vec3<f32> {
    return 0.5 + 0.5 * cos(6.28318 * (h + vec3<f32>(0.0, 0.33, 0.67)));
}

// How much of a pixel lies inside a shape whose signed distance there is d pixels.
fn inside(d: f32) -> f32 {
    return smoothstep(0.75, -0.75, d);
}

// Part `index` over `colour` at pixel `px`: its box `r` (44 logical pixels wide, so r.z / 44 is the
// scale), filled with `fill`, its mark, and its ring when it is the focused part.
fn part(colour: vec3<f32>, px: vec2<f32>, r: vec4<f32>, index: f32, fill: vec3<f32>) -> vec3<f32> {
    let unit = r.z / 44.0;
    let p = px - (r.xy + r.zw * 0.5);
    let d = rounded(p, r.zw * 0.5, 10.0 * unit);
    var out = mix(colour, fill, inside(d));
    if (index == 1.0) {
        let q = p / unit;
        var mark: f32;
        if (scene.paused > 0.5) {
            mark = triangle(vec2<f32>(q.y, q.x - 1.5), 8.0);
        } else {
            let bar = vec2<f32>(2.5, 9.0);
            mark = min(rounded(q - vec2<f32>(-5.0, 0.0), bar, 1.0), rounded(q - vec2<f32>(5.0, 0.0), bar, 1.0));
        }
        out = mix(out, vec3<f32>(0.92, 0.93, 0.97), inside(mark * unit));
    }
    if (index == scene.ring) {
        out = mix(out, vec3<f32>(0.98, 0.98, 1.0), inside(abs(d - 3.5 * unit) - 1.25 * unit));
    }
    return out;
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
    let px = in.uv * scene.size;
    colour = part(colour, px, scene.parts[0], 0.0, shape);
    colour = part(colour, px, scene.parts[1], 1.0, vec3<f32>(0.22, 0.23, 0.33));
    return vec4<f32>(colour, 1.0);
}
