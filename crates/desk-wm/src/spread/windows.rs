//! The windows the spread shows and the order it lays them out in (`SpreadWindow`, `spreadOrder` in
//! `packages/runtime/src/arrange/spread-model.ts`, and the asleep rule of `spreadWindows` in
//! `arrange/spread.ts`). Windows keep their spatial order: rows from the top of the desk down, each
//! from left to right, so a tiled desk spreads in the order it reads.

use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;

use crate::types::Rect;

/// A window as the spread sees it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpreadWindow {
    pub id: String,
    pub title: String,
    /// Where it is drawn now, in app pixels.
    pub rect: Rect,
    /// Covered or unloaded (ADR 0070): a placeholder stands in for its content.
    pub asleep: bool,
}

/// Whether a window shows a placeholder in the spread (`spreadWindows`): its frame was unloaded, or
/// every plugin it shows is covered, so opening the spread never loads every plugin at once.
pub fn asleep(unloaded: bool, plugins: &[String], covered: impl Fn(&str) -> bool) -> bool {
    unloaded || (!plugins.is_empty() && plugins.iter().all(|id| covered(id)))
}

/// Composed and lower-cased, so typed Korean and wide letters match titles.
pub(crate) fn fold(text: &str) -> String {
    text.nfkc().collect::<String>().to_lowercase()
}

pub(crate) fn centre(r: &Rect) -> (f64, f64) {
    (r.x + r.w / 2.0, r.y + r.h / 2.0)
}

/// `windows` in the spread's order for row sizes `rows`: by height into rows, then left to right.
pub fn spread_order(windows: &[SpreadWindow], rows: &[usize]) -> Vec<SpreadWindow> {
    let mut by_y = windows.to_vec();
    by_y.sort_by(|a, b| centre(&a.rect).1.total_cmp(&centre(&b.rect).1));
    let mut out = Vec::with_capacity(by_y.len());
    let mut at = 0;
    for &k in rows {
        let end = (at + k).min(by_y.len());
        let mut row = by_y[at..end].to_vec();
        row.sort_by(|a, b| centre(&a.rect).0.total_cmp(&centre(&b.rect).0));
        out.extend(row);
        at = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_fold_wide_letters_and_case_as_the_runtime_does() {
        assert_eq!(fold("Ｍａｉｌ Ⅳ"), "mail iv");
        assert_eq!(fold("ÉCRAN"), "écran");
        // Hangul typed as jamo matches a title stored composed.
        assert_eq!(fold("\u{1112}\u{1161}\u{11AB}"), "한");
    }

    #[test]
    fn a_window_sleeps_when_unloaded_or_when_every_plugin_it_shows_is_covered() {
        let plugins = ["a".to_string(), "b".to_string()];
        assert!(asleep(true, &[], |_| false));
        assert!(!asleep(false, &[], |_| true));
        assert!(!asleep(false, &plugins, |id| id == "a"));
        assert!(asleep(false, &plugins, |_| true));
    }

    #[test]
    fn rows_fill_from_the_top_of_the_desk_each_left_to_right() {
        let at = |id: &str, x: f64, y: f64| SpreadWindow {
            id: id.into(),
            title: id.into(),
            rect: Rect::new(x, y, 100.0, 100.0),
            asleep: false,
        };
        let windows = [at("c", 500.0, 0.0), at("d", 0.0, 400.0), at("a", 0.0, 10.0)];
        let ids: Vec<String> = spread_order(&windows, &[2, 1])
            .into_iter()
            .map(|w| w.id)
            .collect();
        assert_eq!(ids, ["a", "c", "d"]);
    }
}
