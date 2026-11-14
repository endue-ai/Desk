//! The desk page's picture held aside until its report comes (#269, ADR 0215). The scene is laid
//! out from the report a picture of the page was laid out for (`hosted_reports.rs`), but the page
//! sometimes paints a new size before its report of it comes: drawn at once, that picture would
//! meet the scene of the size before. So a paint of a new size that none of the page's last reports
//! names is copied into a texture aside, and the page's picture stays the one before, with its
//! scene; the report naming that size shows it (`Composed::page_laid`). A paint of the picture's
//! own size, or of a size a report names, is drawn as it comes. At most `MOST_ASIDE` paints go
//! aside in a row, a count, not a time: a page whose reports never name its size still shows.

use desk_compositor::TextureId;

use super::Composed;

/// The most paints of the page put aside in a row.
const MOST_ASIDE: usize = 3;
/// The sizes of the page's last reports kept.
const LAID_KEPT: usize = 16;

/// Whether two sizes in device pixels are one to a pixel (a size in CSS pixels rounds).
fn near(a: (u32, u32), b: (u32, u32)) -> bool {
    a.0.abs_diff(b.0) <= 1 && a.1.abs_diff(b.1) <= 1
}

/// Where a paint of the page goes.
#[derive(Debug, PartialEq, Eq)]
pub enum To {
    /// The page's picture, drawn with the scene.
    Shown,
    /// The texture aside; `fresh` when it starts a picture there (copied whole, never over the
    /// pixels of one before).
    Aside { fresh: bool },
}

/// The sizes the page's last reports were laid out for and the picture aside.
#[derive(Default)]
pub struct PageAside {
    laid: Vec<(u32, u32)>,
    aside: Option<(u32, u32)>,
    in_a_row: usize,
    /// The texture paints aside go to.
    pub(super) spare: Option<TextureId>,
}

impl PageAside {
    /// Where the page's paint of `size` device pixels goes, its picture being `shown` pixels.
    pub fn paint(&mut self, size: (u32, u32), shown: Option<(u32, u32)>) -> To {
        let named = self.laid.iter().any(|l| near(*l, size));
        let same = shown.is_none_or(|s| s == size);
        if same || named || self.in_a_row >= MOST_ASIDE {
            self.aside = None;
            self.in_a_row = 0;
            return To::Shown;
        }
        self.in_a_row += 1;
        let fresh = self.aside != Some(size);
        self.aside = Some(size);
        To::Aside { fresh }
    }

    /// The page reported a layout for `size` device pixels: whether the picture aside is of it.
    pub fn laid(&mut self, size: (u32, u32)) -> bool {
        self.laid.push(size);
        if self.laid.len() > LAID_KEPT {
            self.laid.remove(0);
        }
        if !self.aside.is_some_and(|a| near(a, size)) {
            return false;
        }
        self.aside = None;
        self.in_a_row = 0;
        true
    }
}

impl Composed {
    /// The texture the page's paint of `size` pixels is copied into, and whether it is aside.
    pub(super) fn page_texture(&mut self, size: (u32, u32)) -> (TextureId, bool) {
        let shown = self.texture(super::super::PAGE);
        let had = self.frames.size(shown);
        match self.page.paint(size, had) {
            To::Shown => (shown, false),
            To::Aside { fresh } => {
                let spare = self.page.spare.unwrap_or_else(|| {
                    self.next += 1;
                    TextureId(self.next)
                });
                self.page.spare = Some(spare);
                if fresh {
                    self.frames.destroy(&mut self.compositor, spare);
                    crate::frame_trace::line(
                        "aside",
                        serde_json::json!({ "size": [size.0, size.1] }),
                    );
                }
                (spare, true)
            }
        }
    }

    /// The page reported a layout for `size` device pixels: the picture aside of that size, if
    /// one is, becomes the page's picture, whole, and the scene is laid out again.
    pub fn page_laid(&mut self, size: (u32, u32)) -> bool {
        if !self.page.laid(size) {
            return false;
        }
        let Some(spare) = self.page.spare else {
            return false;
        };
        let page = super::super::PAGE.to_owned();
        let shown = self.textures.insert(page, spare);
        self.page.spare = shown;
        self.page_damage.push(Vec::new());
        self.dirty = true;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{PageAside, To};

    #[test]
    fn a_paint_of_a_size_no_report_names_goes_aside_until_one_does() {
        let mut page = PageAside::default();
        assert!(!page.laid((2880, 1800)));
        assert_eq!(page.paint((2880, 1800), None), To::Shown, "the first");
        assert_eq!(page.paint((2880, 1800), Some((2880, 1800))), To::Shown);
        // The page painted 3200×2000 before its report came.
        let shown = Some((2880, 1800));
        assert_eq!(page.paint((3200, 2000), shown), To::Aside { fresh: true });
        assert_eq!(page.paint((3200, 2000), shown), To::Aside { fresh: false });
        assert!(page.laid((3201, 2000)), "its report, to a pixel: shown now");
        assert_eq!(page.paint((3200, 2000), Some((3200, 2000))), To::Shown);
    }

    #[test]
    fn a_size_a_report_named_is_drawn_at_once_and_at_most_three_go_aside_in_a_row() {
        let mut page = PageAside::default();
        let shown = Some((2880, 1800));
        page.laid((3000, 1900));
        assert_eq!(
            page.paint((3000, 1900), shown),
            To::Shown,
            "its report came first"
        );
        assert!(!page.laid((3100, 1950)), "nothing aside");
        for (i, w) in [3200, 3300, 3400].into_iter().enumerate() {
            assert_eq!(
                page.paint((w, 2000), shown),
                To::Aside { fresh: true },
                "{i}"
            );
        }
        assert_eq!(
            page.paint((3500, 2000), shown),
            To::Shown,
            "a page no report names"
        );
        assert!(!page.laid((3400, 2000)), "what was aside went");
    }
}
