//! The fonts the compositor sets chrome text in: the machine's (system font discovery) or a given
//! set (tests, a bundle), with cosmic-text's fallback across scripts behind them. A CSS font stack
//! resolves to the first family present here.

use crate::text::style::FontStack;
use cosmic_text::skrifa::{self, MetadataProvider as _};
use cosmic_text::{Family, FontSystem, SwashCache, fontdb};
use std::collections::HashMap;
use std::sync::Arc;

/// System UI families, tried in order for `sans-serif`, `system-ui` and `-apple-system`.
const SANS: &[&str] = &[
    "SF Pro Text",
    "SF Pro",
    "System Font",
    "Helvetica Neue",
    "Segoe UI",
    "Inter",
    "Noto Sans",
    "Cantarell",
    "Ubuntu",
    "DejaVu Sans",
    "Liberation Sans",
    "Arial",
    "Helvetica",
];
const MONO: &[&str] = &[
    "SF Mono",
    "Menlo",
    "Cascadia Mono",
    "Consolas",
    "JetBrains Mono",
    "Noto Sans Mono",
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Courier New",
];
const SERIF: &[&str] = &[
    "New York",
    "Times New Roman",
    "Noto Serif",
    "DejaVu Serif",
    "Liberation Serif",
    "Georgia",
];

/// A font database with shaping and rasterising state. Loading the machine's fonts takes a moment
/// (up to a second in a release build), so make one and hand it to the compositor.
pub struct Fonts {
    pub(crate) system: FontSystem,
    pub(crate) swash: SwashCache,
    resolved: HashMap<Arc<str>, Arc<str>>,
    weights: HashMap<(Arc<str>, u16), u16>,
}

impl std::fmt::Debug for Fonts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Fonts")
            .field("faces", &self.faces())
            .finish()
    }
}

impl Fonts {
    /// The machine's fonts, found where the OS keeps them (fontconfig's folders on Linux), with
    /// the generic families set to the platform's UI fonts.
    pub fn system() -> Fonts {
        let mut system = FontSystem::new();
        let db = system.db_mut();
        let pick = |db: &fontdb::Database, names: &[&str]| {
            names
                .iter()
                .find(|n| has_family(db, n))
                .map(|n| (*n).to_owned())
        };
        let any = db
            .faces()
            .next()
            .and_then(|f| f.families.first().map(|(n, _)| n.clone()));
        if let Some(sans) = pick(db, SANS).or(any) {
            db.set_sans_serif_family(sans);
        }
        if let Some(mono) = pick(db, MONO) {
            db.set_monospace_family(mono);
        }
        if let Some(serif) = pick(db, SERIF) {
            db.set_serif_family(serif);
        }
        Fonts::with_system(system)
    }

    /// Only the fonts given (TrueType or OpenType bytes, collections too), nothing of the machine's:
    /// the same text sets the same way on every OS. The first font is the generic sans and serif,
    /// the first monospaced one the generic monospace.
    pub fn from_data(fonts: impl IntoIterator<Item = Vec<u8>>) -> Fonts {
        let mut db = fontdb::Database::new();
        for data in fonts {
            db.load_font_data(data);
        }
        let first = db
            .faces()
            .next()
            .and_then(|f| f.families.first().map(|(n, _)| n.clone()));
        let mono = db
            .faces()
            .find(|f| f.monospaced)
            .and_then(|f| f.families.first().map(|(n, _)| n.clone()));
        if let Some(first) = first {
            db.set_sans_serif_family(first.clone());
            db.set_serif_family(first.clone());
            db.set_monospace_family(mono.unwrap_or(first));
        }
        Fonts::with_system(FontSystem::new_with_locale_and_db("en-US".into(), db))
    }

    fn with_system(system: FontSystem) -> Fonts {
        Fonts {
            system,
            swash: SwashCache::new(),
            resolved: HashMap::new(),
            weights: HashMap::new(),
        }
    }

    /// Add a font (TrueType or OpenType bytes).
    pub fn load(&mut self, data: Vec<u8>) {
        self.system.db_mut().load_font_data(data);
        self.resolved.clear();
        self.weights.clear();
    }

    /// How many faces the database holds.
    pub fn faces(&self) -> usize {
        self.system.db().len()
    }

    /// Whether a face of `family` is here (case-insensitive).
    pub fn has_family(&self, family: &str) -> bool {
        has_family(self.system.db(), family)
    }

    /// The family `sans-serif` means here.
    pub fn sans_family(&self) -> String {
        self.system.db().family_name(&Family::SansSerif).to_owned()
    }

    /// The family `stack` sets text in here.
    pub fn family_of(&mut self, stack: &FontStack) -> String {
        self.resolve(stack).to_string()
    }

    /// The family a stack sets text in here: its first family present, a generic one as the
    /// family it stands for here, the sans family when none is. Always a family's name: shaped as
    /// cosmic-text's generic monospace, glyphs from a fallback font get no width.
    pub(crate) fn resolve(&mut self, stack: &FontStack) -> Arc<str> {
        if let Some(known) = self.resolved.get(&stack.0) {
            return Arc::clone(known);
        }
        let db = self.system.db();
        let generic = |family: Family<'_>| Some(db.family_name(&family).to_owned());
        let name = stack
            .families()
            .find_map(|family| match family.to_ascii_lowercase().as_str() {
                "sans-serif" | "system-ui" | "-apple-system" | "blinkmacsystemfont"
                | "ui-sans-serif" => generic(Family::SansSerif),
                "serif" | "ui-serif" => generic(Family::Serif),
                "monospace" | "ui-monospace" => generic(Family::Monospace),
                _ => db
                    .faces()
                    .flat_map(|f| f.families.iter())
                    .find(|(name, _)| name.eq_ignore_ascii_case(family))
                    .map(|(name, _)| name.clone()),
            })
            .unwrap_or_else(|| db.family_name(&Family::SansSerif).to_owned());
        let name: Arc<str> = Arc::from(name);
        self.resolved
            .insert(Arc::clone(&stack.0), Arc::clone(&name));
        name
    }

    /// The weight `family` sets `want` in: `want` itself when a face has it or a variable face
    /// spans it, otherwise the face CSS's font matching picks. cosmic-text takes the family only
    /// at a weight it has, and falls back to other families for any other.
    pub(crate) fn weight(&mut self, family: &str, want: u16) -> u16 {
        if let Some(known) = self.weights.get(&(Arc::from(family), want)) {
            return *known;
        }
        let db = self.system.db();
        let faces: Vec<&fontdb::FaceInfo> = db
            .faces()
            .filter(|f| {
                f.families
                    .iter()
                    .any(|(n, _)| n.eq_ignore_ascii_case(family))
            })
            .collect();
        let spans = |face: &&fontdb::FaceInfo| {
            db.with_face_data(face.id, |data, index| {
                let font = skrifa::FontRef::from_index(data, index).ok()?;
                let axis = font.axes().get_by_tag(skrifa::Tag::new(b"wght"))?;
                Some((axis.min_value()..=axis.max_value()).contains(&f32::from(want)))
            })
            .flatten()
            .unwrap_or(false)
        };
        let weights: Vec<u16> = faces.iter().map(|f| f.weight.0).collect();
        let weight = if weights.contains(&want) || faces.iter().any(spans) {
            want
        } else {
            nearest(&weights, want)
        };
        self.weights.insert((Arc::from(family), want), weight);
        weight
    }
}

/// The weight CSS's font matching picks among `weights` for `want`: from 400 to 500 the heavier
/// ones up to 500 first, then the lighter ones, then the heavier; below 400 lighter first; above
/// 500 heavier first.
fn nearest(weights: &[u16], want: u16) -> u16 {
    let below = || weights.iter().copied().filter(|w| *w < want).max();
    let above = || weights.iter().copied().filter(|w| *w > want).min();
    let picked = if (400..=500).contains(&want) {
        let up_to_500 = weights
            .iter()
            .copied()
            .filter(|w| *w > want && *w <= 500)
            .min();
        up_to_500.or_else(below).or_else(above)
    } else if want < 400 {
        below().or_else(above)
    } else {
        above().or_else(below)
    };
    picked.unwrap_or(want)
}

fn has_family(db: &fontdb::Database, family: &str) -> bool {
    db.faces().any(|f| {
        f.families
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case(family))
    })
}

#[cfg(test)]
mod tests {
    use super::nearest;

    #[test]
    fn a_missing_weight_takes_the_face_css_would() {
        let regular_bold = [400, 700];
        assert_eq!(
            nearest(&regular_bold, 500),
            400,
            "a title's 500 in Menlo is its 400"
        );
        assert_eq!(nearest(&regular_bold, 600), 700);
        assert_eq!(nearest(&regular_bold, 300), 400);
        assert_eq!(nearest(&[300, 500, 700], 400), 500);
        assert_eq!(nearest(&[700], 400), 700);
        assert_eq!(nearest(&[], 400), 400);
    }
}
