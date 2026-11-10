//! The look of the desk's chrome, read from the flat token table (ADR 0145): which token each part
//! of a window frame, a title bar, a bar, a snap preview, a toast and a placeholder takes, the
//! same tokens the web shell's CSS reads today. A token the table lacks, or holds in a form this
//! does not read, keeps the endue dark theme's value.

mod css;
mod tokens;

pub use tokens::Tokens;

use crate::text::{FontStack, TextAlign, TextStyle};
use crate::types::{Color, Shadow};
use glam::Vec2;

/// A window: its frame, its title bar and the bar's text.
#[derive(Clone, Debug, PartialEq)]
pub struct WindowStyle {
    pub fill: Color,
    pub border: Color,
    pub border_focused: Color,
    pub border_width: f32,
    pub radius: f32,
    pub shadow: Option<Shadow>,
    pub title_height: f32,
    /// The line under the title bar.
    pub divider: Color,
    /// From the frame's edge to the title.
    pub padding: f32,
    pub title: TextStyle,
    pub subtitle: TextStyle,
}

/// An edge bar (ADR 0028) and its labels.
#[derive(Clone, Debug, PartialEq)]
pub struct BarStyle {
    pub fill: Color,
    pub border: Color,
    pub radius: f32,
    pub text: TextStyle,
}

/// Where a dragged window will snap (ADR 0128).
#[derive(Clone, Debug, PartialEq)]
pub struct SnapStyle {
    pub fill: Color,
    pub stroke: Color,
    pub stroke_width: f32,
    pub radius: f32,
}

/// A toast and its message.
#[derive(Clone, Debug, PartialEq)]
pub struct ToastStyle {
    pub fill: Color,
    pub border: Color,
    pub radius: f32,
    pub shadow: Option<Shadow>,
    pub padding: f32,
    pub text: TextStyle,
}

/// What a window without live content shows (asleep, gone, loading) and its label.
#[derive(Clone, Debug, PartialEq)]
pub struct PlaceholderStyle {
    pub fill: Color,
    pub text: TextStyle,
}

/// Everything the compositor draws of its own, styled by one look.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeTheme {
    pub wallpaper: Color,
    pub window: WindowStyle,
    pub bar: BarStyle,
    pub snap: SnapStyle,
    pub toast: ToastStyle,
    pub placeholder: PlaceholderStyle,
}

impl Default for ChromeTheme {
    /// The endue dark theme, the desk's default look.
    fn default() -> ChromeTheme {
        ChromeTheme::from_tokens(&Tokens::default())
    }
}

/// The endue dark theme's values, for tokens a table lacks.
mod endue {
    pub const BACKGROUND: u32 = 0x141416;
    pub const CARD: u32 = 0x1e1d21;
    pub const MUTED: u32 = 0x242127;
    pub const BORDER: u32 = 0x333136;
    pub const INPUT: u32 = 0x837991;
    pub const TEXT: u32 = 0xf2f0f5;
    pub const TEXT_MUTED: u32 = 0xb0adb7;
    pub const PRIMARY: u32 = 0xb6a3f5;
    pub const FONT: &str = r#""Inter", "SUIT Variable", "SUIT", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif"#;
}

impl ChromeTheme {
    /// The chrome as `tokens` styles it.
    pub fn from_tokens(tokens: &Tokens) -> ChromeTheme {
        let color = |name: &str, fallback: Color| tokens.color(name).unwrap_or(fallback);
        let hex = Color::hex;
        let length = |name: &str, fallback: f32| tokens.length(name).unwrap_or(fallback);
        let shadow = |name: &str, fallback: Option<Shadow>| tokens.shadow(name).unwrap_or(fallback);
        let font = tokens
            .font("fontSans")
            .unwrap_or_else(|| FontStack::new(endue::FONT));
        let text = |size: &str, fallback: f32, weight: u16, colour: Color| TextStyle {
            font: font.clone(),
            size: length(size, fallback),
            weight,
            color: colour,
            line_height: 1.4,
            align: TextAlign::Start,
        };
        let card = color("card", hex(endue::CARD));
        let border = color("border", hex(endue::BORDER));
        let ink = color("text", hex(endue::TEXT));
        let muted_ink = color("textMuted", hex(endue::TEXT_MUTED));
        let radius = length("radiusLg", 12.0);
        let primary = hex(endue::PRIMARY);
        let drop = |y: f32, blur: f32, alpha: f32| Shadow {
            offset: Vec2::new(0.0, y),
            blur,
            spread: 0.0,
            color: Color::BLACK.fade(alpha),
        };
        let window = WindowStyle {
            // A translucent theme's surface is the card mixed with transparency.
            fill: tokens.color("surface").unwrap_or(card),
            border,
            border_focused: color("input", hex(endue::INPUT)),
            border_width: length("borderWidth", 1.0),
            radius,
            shadow: shadow("shadowMd", Some(drop(8.0, 24.0, 0.45))),
            title_height: 40.0,
            divider: border,
            padding: length("space3", 12.0),
            title: text("textSm", 14.0, 500, ink),
            subtitle: text("textXs", 12.0, 400, muted_ink),
        };
        let bar = BarStyle {
            fill: card,
            border,
            radius,
            text: text("textXs", 12.0, 500, muted_ink),
        };
        let snap = SnapStyle {
            fill: color("primarySoft", primary.fade(0.12)),
            stroke: color("primaryBorder", primary.fade(0.34)),
            stroke_width: 2.0,
            radius,
        };
        let toast = ToastStyle {
            fill: color("toastBg", card),
            border: color("toastBorder", border),
            radius: length("toastRadius", radius),
            shadow: shadow("toastShadow", Some(drop(8.0, 24.0, 0.45))),
            padding: length("space3", 12.0),
            text: text("textSm", 14.0, 400, color("toastFg", ink)),
        };
        let placeholder = PlaceholderStyle {
            fill: color("muted", hex(endue::MUTED)),
            text: TextStyle {
                align: TextAlign::Center,
                ..text("textSm", 14.0, 400, muted_ink)
            },
        };
        ChromeTheme {
            wallpaper: color("background", hex(endue::BACKGROUND)),
            window,
            bar,
            snap,
            toast,
            placeholder,
        }
    }
}
