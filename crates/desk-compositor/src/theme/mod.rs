//! The look of the desk's chrome, read from the flat token table (ADR 0146): which token each part
//! of a window frame, a title bar, a bar, a snap preview, a toast, a hover title, a placeholder, the
//! spread and the canvas map takes, the same tokens the web shell's CSS reads today. A token the
//! table lacks, or holds in a form this does not read, keeps the endue dark theme's value.

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

/// A page's hover title, which an off-screen page leaves to the compositor (#156), as the shell's
/// `.tooltip` looks: its box, its padding across and down, the widest its text runs before it
/// breaks, and the text (its line height a multiple of the size, as CSS's 20 px on 12 px).
#[derive(Clone, Debug, PartialEq)]
pub struct TooltipStyle {
    pub fill: Color,
    pub radius: f32,
    pub shadow: Option<Shadow>,
    pub padding_x: f32,
    pub padding_y: f32,
    pub max_width: f32,
    pub text: TextStyle,
}

/// What a window without live content shows (asleep, gone, loading): its title, a line under it
/// and the actions it offers, and the scrim over a window that stopped answering.
#[derive(Clone, Debug, PartialEq)]
pub struct PlaceholderStyle {
    pub fill: Color,
    pub text: TextStyle,
    pub line: TextStyle,
    pub scrim: Color,
    /// Over a sleeping window's greyed last frame.
    pub veil: Color,
}

/// The spread (ADR 0116, `arrange.css`): the scrim over the desk, the filter field and the bar under
/// it with the count and the hint, the message when nothing matches, and the selected card's ring.
#[derive(Clone, Debug, PartialEq)]
pub struct SpreadStyle {
    pub scrim: Color,
    pub field: Color,
    pub field_border: Color,
    pub field_radius: f32,
    pub field_height: f32,
    pub field_padding: f32,
    pub field_shadow: Option<Shadow>,
    pub text: TextStyle,
    /// The field's placeholder while nothing is typed.
    pub placeholder: TextStyle,
    pub meta: Color,
    pub meta_border: Color,
    pub meta_radius: f32,
    pub meta_text: TextStyle,
    pub count: TextStyle,
    /// Round the selected card, and its width.
    pub ring: Color,
    pub ring_width: f32,
    /// Under every card.
    pub card_shadow: Option<Shadow>,
}

/// The canvas map (ADR 0082, `shell/minimap.css`): its box, the canvas in it, each normal window
/// (the focused one marked), the part in sight and the button that folds it.
#[derive(Clone, Debug, PartialEq)]
pub struct MapStyle {
    pub fill: Color,
    pub border: Color,
    pub radius: f32,
    pub shadow: Option<Shadow>,
    pub padding: f32,
    pub canvas: Color,
    pub canvas_radius: f32,
    pub window: Color,
    pub window_border: Color,
    pub focused: Color,
    pub focused_border: Color,
    pub small_radius: f32,
    pub view: Color,
    pub view_border: Color,
    /// The fold button folded (on its own), and the icon on it.
    pub button_size: f32,
    pub icon: Color,
}

/// Everything the compositor draws of its own, styled by one look.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeTheme {
    pub wallpaper: Color,
    pub window: WindowStyle,
    pub bar: BarStyle,
    pub snap: SnapStyle,
    pub toast: ToastStyle,
    pub tooltip: TooltipStyle,
    pub placeholder: PlaceholderStyle,
    pub spread: SpreadStyle,
    pub map: MapStyle,
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
    pub const POPOVER: u32 = 0x2b2731;
    pub const TOOLTIP: u32 = 0x403a49;
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
        let tip_size = length("textXs", 12.0);
        let tooltip = TooltipStyle {
            fill: color("tooltip", hex(endue::TOOLTIP)),
            radius: length("tooltipRadius", length("radiusMd", 8.0)),
            shadow: shadow("tooltipShadow", Some(drop(1.0, 2.0, 0.4))),
            padding_x: length("space2", 8.0),
            padding_y: length("space1", 4.0),
            max_width: 360.0,
            text: TextStyle {
                line_height: 20.0 / tip_size.max(1.0),
                ..text("textXs", 12.0, 400, color("tooltipText", ink))
            },
        };
        let muted = color("muted", hex(endue::MUTED));
        let placeholder = PlaceholderStyle {
            fill: muted,
            text: TextStyle {
                align: TextAlign::Center,
                ..text("textSm", 14.0, 400, muted_ink)
            },
            line: TextStyle {
                align: TextAlign::Center,
                ..text("textXs", 12.0, 400, muted_ink)
            },
            scrim: muted.fade(0.92),
            veil: muted.fade(0.8),
        };
        let accent = color("accent", primary);
        let popover = color("popover", hex(endue::POPOVER));
        let small = length("radiusSm", 4.0);
        let medium = length("radiusMd", 8.0);
        let spread = SpreadStyle {
            scrim: color("dialogScrim", Color::BLACK.fade(0.6)),
            field: color("fieldBg", card),
            field_border: color("fieldFocusBorder", window.border_focused),
            field_radius: length("fieldRadius", medium),
            field_height: length("fieldHeight", 40.0),
            field_padding: length("fieldPaddingX", 12.0),
            field_shadow: window.shadow,
            text: text("textSm", 14.0, 400, ink),
            placeholder: text("textSm", 14.0, 400, muted_ink),
            meta: popover,
            meta_border: border,
            meta_radius: medium,
            meta_text: text("textXs", 12.0, 400, ink),
            count: text("textXs", 12.0, 600, ink),
            ring: accent,
            ring_width: length("focusWidth", 2.0),
            card_shadow: window.shadow,
        };
        let map = MapStyle {
            fill: card,
            border,
            radius,
            shadow: window.shadow,
            padding: length("space1", 4.0),
            canvas: muted,
            canvas_radius: medium,
            window: muted_ink.fade(0.22),
            window_border: muted_ink.fade(0.45),
            focused: accent.fade(0.35),
            focused_border: accent,
            small_radius: small,
            view: color("primarySoft", primary.fade(0.12)),
            view_border: accent,
            button_size: length("controlSm", 32.0),
            icon: color("iconButtonFg", ink),
        };
        ChromeTheme {
            wallpaper: color("background", hex(endue::BACKGROUND)),
            window,
            bar,
            snap,
            toast,
            tooltip,
            placeholder,
            spread,
            map,
        }
    }
}
