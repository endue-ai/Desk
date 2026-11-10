//! The CSS values a theme's tokens hold, read as the compositor needs them: colours (`#hex`,
//! `rgb()`, `rgba()`, `hsl()`, `oklch()`, `transparent`), lengths in px, box shadows and numbers.
//! The same colour grammar as `@endue-ai/ui/theme`'s `parseColor`, so both read a theme alike.

use crate::types::{Color, Shadow};
use glam::Vec2;

/// A CSS colour, `None` when it is not one this reads.
pub fn color(input: &str) -> Option<Color> {
    let s = input.trim().to_ascii_lowercase();
    match s.as_str() {
        "transparent" => return Some(Color::TRANSPARENT),
        "black" => return Some(Color::BLACK),
        "white" => return Some(Color::WHITE),
        _ => {}
    }
    if let Some(hex) = s.strip_prefix('#') {
        return hex_color(hex);
    }
    if let Some(args) = s
        .strip_prefix("color-mix(")
        .and_then(|a| a.strip_suffix(')'))
    {
        return color_mix(args);
    }
    let (name, args) = s.strip_suffix(')')?.split_once('(')?;
    let parts: Vec<&str> = args
        .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
        .filter(|p| !p.is_empty())
        .collect();
    if !(3..=4).contains(&parts.len()) {
        return None;
    }
    let num = |p: &str, scale: f32| -> Option<f32> {
        match p.strip_suffix('%') {
            Some(pct) => Some(pct.parse::<f32>().ok()? / 100.0 * scale),
            None => p.trim_end_matches("deg").parse().ok(),
        }
    };
    let alpha = match parts.get(3) {
        Some(a) => num(a, 1.0)?.clamp(0.0, 1.0),
        None => 1.0,
    };
    let rgb = match name {
        "rgb" | "rgba" => [
            num(parts[0], 255.0)?,
            num(parts[1], 255.0)?,
            num(parts[2], 255.0)?,
        ],
        "hsl" | "hsla" => hsl(
            num(parts[0], 360.0)?,
            num(parts[1], 1.0)?,
            num(parts[2], 1.0)?,
        ),
        "oklch" => oklch(
            num(parts[0], 1.0)?,
            num(parts[1], 0.4)?,
            num(parts[2], 360.0)?,
        ),
        _ => return None,
    };
    if rgb.iter().any(|v| !v.is_finite()) || !alpha.is_finite() {
        return None;
    }
    let [r, g, b] = rgb.map(|v| v.clamp(0.0, 255.0) / 255.0);
    Some(Color::new(r, g, b, alpha))
}

/// `color-mix(in srgb, A [p%], B [q%])`, as a translucent theme's `surface` is the card mixed with
/// transparency: premultiplied, in sRGB, the percentages filling in each other.
fn color_mix(args: &str) -> Option<Color> {
    let parts = split_top(args, ',');
    let [space, a, b] = parts.as_slice() else {
        return None;
    };
    if space.trim() != "in srgb" {
        return None;
    }
    let side = |part: &str| -> Option<(Color, Option<f32>)> {
        let (c, pct) = match part.rsplit_once(' ') {
            Some((c, p)) if p.ends_with('%') => (
                c,
                Some(p.trim_end_matches('%').parse::<f32>().ok()? / 100.0),
            ),
            _ => (part, None),
        };
        Some((color(c)?, pct))
    };
    let ((ca, pa), (cb, pb)) = (side(a)?, side(b)?);
    let (pa, pb) = match (pa, pb) {
        (Some(pa), Some(pb)) => (pa, pb),
        (Some(pa), None) => (pa, 1.0 - pa),
        (None, Some(pb)) => (1.0 - pb, pb),
        (None, None) => (0.5, 0.5),
    };
    let total = pa + pb;
    if total <= 0.0 {
        return None;
    }
    let (wa, wb) = (pa / total, pb / total);
    let alpha = ca.a * wa + cb.a * wb;
    if alpha <= 0.0 {
        return Some(Color::TRANSPARENT);
    }
    let mix = |x: f32, y: f32| (x * ca.a * wa + y * cb.a * wb) / alpha;
    // Percentages summing under 100% leave the rest transparent.
    let alpha = alpha * total.min(1.0);
    Some(Color::new(
        mix(ca.r, cb.r),
        mix(ca.g, cb.g),
        mix(ca.b, cb.b),
        alpha,
    ))
}

fn hex_color(hex: &str) -> Option<Color> {
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let full: String = match hex.len() {
        3 | 4 => hex.chars().flat_map(|c| [c, c]).collect(),
        6 | 8 => hex.to_owned(),
        _ => return None,
    };
    let byte = |i: usize| u8::from_str_radix(&full[i..i + 2], 16).ok();
    let a = if full.len() == 8 { byte(6)? } else { 255 };
    Some(Color::rgba8(byte(0)?, byte(2)?, byte(4)?, a))
}

fn hsl(h: f32, s: f32, l: f32) -> [f32; 3] {
    let k = |n: f32| (n + h / 30.0).rem_euclid(12.0);
    let a = s * l.min(1.0 - l);
    let f = |n: f32| l - a * (k(n) - 3.0).min(9.0 - k(n)).clamp(-1.0, 1.0);
    [255.0 * f(0.0), 255.0 * f(8.0), 255.0 * f(4.0)]
}

/// OKLCH to sRGB 0–255, lowering chroma until the colour fits, so the hue stays (as the gate does).
fn oklch(l: f32, c: f32, h: f32) -> [f32; 3] {
    let linear = |c: f32| {
        let (a, b) = (c * h.to_radians().cos(), c * h.to_radians().sin());
        let l = l.clamp(0.0, 1.0);
        let lms = [
            (l + 0.396_337_8 * a + 0.215_803_76 * b).powi(3),
            (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3),
            (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3),
        ];
        [
            4.076_741_7 * lms[0] - 3.307_711_6 * lms[1] + 0.230_969_94 * lms[2],
            -1.268_438 * lms[0] + 2.609_757_4 * lms[1] - 0.341_319_38 * lms[2],
            -0.004_196_086 * lms[0] - 0.703_418_6 * lms[1] + 1.707_614_7 * lms[2],
        ]
    };
    let mut chroma = c.max(0.0);
    let mut lin = linear(chroma);
    for _ in 0..24 {
        if lin.iter().all(|v| (-1e-4..=1.0 + 1e-4).contains(v)) || chroma < 1e-4 {
            break;
        }
        chroma *= 0.8;
        lin = linear(chroma);
    }
    lin.map(|v| {
        let v = v.clamp(0.0, 1.0);
        255.0
            * if v <= 0.003_130_8 {
                12.92 * v
            } else {
                1.055 * v.powf(1.0 / 2.4) - 0.055
            }
    })
}

/// A length in px (`12px`, `0`, a bare number), `rem` at 16px; `None` for anything else.
pub fn length(input: &str) -> Option<f32> {
    let s = input.trim();
    let value = if let Some(px) = s.strip_suffix("px") {
        px.trim().parse().ok()?
    } else if let Some(rem) = s.strip_suffix("rem") {
        rem.trim().parse::<f32>().ok()? * 16.0
    } else {
        s.parse().ok()?
    };
    value.is_finite().then_some(value)
}

/// A `box-shadow`: `Some(None)` for `none`, the strongest outer layer of a list (a compositor
/// rectangle has one shadow), `None` when it is not one this reads.
pub fn shadow(input: &str) -> Option<Option<Shadow>> {
    let s = input.trim();
    if s.eq_ignore_ascii_case("none") {
        return Some(None);
    }
    let layers: Vec<Shadow> = split_top(s, ',')
        .into_iter()
        .filter_map(|layer| shadow_layer(&layer))
        .collect();
    let strongest = layers
        .into_iter()
        .reduce(|a, b| if b.color.a > a.color.a { b } else { a })?;
    Some(Some(strongest))
}

/// One layer, `offset-x offset-y [blur [spread]] colour` in any order of colour and lengths;
/// `inset` layers are not drawn outside a box, so they read as none.
fn shadow_layer(layer: &str) -> Option<Shadow> {
    let words = split_top(layer, ' ');
    if words.iter().any(|w| w.eq_ignore_ascii_case("inset")) {
        return None;
    }
    let mut lengths = Vec::new();
    let mut colour = None;
    for word in words.iter().filter(|w| !w.is_empty()) {
        match length(word) {
            Some(l) => lengths.push(l),
            None => colour = Some(color(word)?),
        }
    }
    if !(2..=4).contains(&lengths.len()) {
        return None;
    }
    Some(Shadow {
        offset: Vec2::new(lengths[0], lengths[1]),
        blur: lengths.get(2).copied().unwrap_or(0.0).max(0.0),
        spread: lengths.get(3).copied().unwrap_or(0.0),
        color: colour.unwrap_or(Color::BLACK),
    })
}

/// `s` split at `sep` outside parentheses.
fn split_top(s: &str, sep: char) -> Vec<String> {
    let (mut parts, mut current, mut depth) = (Vec::new(), String::new(), 0usize);
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        if c == sep && depth == 0 {
            parts.push(std::mem::take(&mut current).trim().to_owned());
        } else {
            current.push(c);
        }
    }
    parts.push(current.trim().to_owned());
    parts.retain(|p| !p.is_empty());
    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(a: Color, b: Color) -> bool {
        let d = [a.r - b.r, a.g - b.g, a.b - b.b, a.a - b.a];
        d.iter().all(|v| v.abs() < 0.01)
    }

    #[test]
    fn colours_read_as_the_theme_gate_reads_them() {
        assert_eq!(color("#141416"), Some(Color::hex(0x141416)));
        assert_eq!(color("#fff"), Some(Color::WHITE));
        assert_eq!(color("#00000080").map(|c| c.a), Some(128.0 / 255.0));
        let soft = color("rgba(182, 163, 245, 0.12)").unwrap();
        assert!(near(soft, Color::rgba8(182, 163, 245, 255).fade(0.12)));
        assert!(near(color("rgb(182 163 245 / 12%)").unwrap(), soft));
        assert!(near(
            color("hsl(0, 100%, 50%)").unwrap(),
            Color::hex(0xff0000)
        ));
        // L 0.5 without chroma is the grey of linear 0.125; hue 145 is a green.
        let grey = color("oklch(0.5 0 0)").unwrap();
        assert!(near(grey, Color::rgba8(99, 99, 99, 255)), "{grey:?}");
        let green = color("oklch(0.7 0.12 145)").unwrap();
        assert!(green.g > green.r && green.g > green.b, "{green:?}");
        assert_eq!(color("transparent"), Some(Color::TRANSPARENT));
        // A translucent theme's surface: its card at 85%.
        let surface = color("color-mix(in srgb, #1e1d21 85%, transparent)").unwrap();
        assert!(
            near(surface, Color::hex(0x1e1d21).fade(0.85)),
            "{surface:?}"
        );
        let half = color("color-mix(in srgb, #000000, #ffffff)").unwrap();
        assert!(near(half, Color::new(0.5, 0.5, 0.5, 1.0)), "{half:?}");
        assert_eq!(color("var(--desk-card)"), None);
        assert_eq!(color("#12"), None);
        assert_eq!(color("rgb(1, 2)"), None);
    }

    #[test]
    fn lengths_and_shadows() {
        assert_eq!(length("12px"), Some(12.0));
        assert_eq!(length("0"), Some(0.0));
        assert_eq!(length("1.5rem"), Some(24.0));
        assert_eq!(length("var(--desk-radius-lg)"), None);
        assert_eq!(shadow("none"), Some(None));
        let md = shadow("0 8px 24px rgba(0, 0, 0, 0.45)").unwrap().unwrap();
        assert_eq!(
            (md.offset, md.blur, md.spread),
            (Vec2::new(0.0, 8.0), 24.0, 0.0)
        );
        assert!((md.color.a - 0.45).abs() < 1e-6);
        // Amber's glow under a drop: the drop, the stronger layer, is the one drawn.
        let two = shadow("0 0 24px rgba(255, 160, 0, 0.08), 0 8px 24px rgba(0, 0, 0, 0.6)");
        assert_eq!(two.unwrap().unwrap().offset, Vec2::new(0.0, 8.0));
        assert_eq!(shadow("inset 0 -2px 0 #b6a3f5"), None);
        assert_eq!(
            shadow("0 1px"),
            Some(Some(Shadow {
                offset: Vec2::new(0.0, 1.0),
                blur: 0.0,
                spread: 0.0,
                color: Color::BLACK
            }))
        );
    }
}
