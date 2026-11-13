//! Which of the desk's processes run Chromium's full pipeline, `--run-all-compositor-stages-before-
//! draw` (ADR 0157, #248, ADR 0210). In the browser process it makes each browser's display wait for
//! every surface it sent a begin frame to with no deadline, and every surface's dependencies too; in
//! a renderer it makes the renderer's compositor wait for its main frame before it draws. The browser
//! decides for every process: Chromium passes the browser's switch on to each child, and a child it
//! is not passed to takes it at its launch when the choice says so (`app.rs`). A development build
//! measures another choice with `DESK_FULL_PIPELINE` (`all`, `renderers` or `none`).

use std::sync::OnceLock;

/// Chromium's switch.
pub const SWITCH: &str = "run-all-compositor-stages-before-draw";

/// The processes that run the full pipeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pipeline {
    /// Every process: a begin frame ends only when every surface it reached has finished it.
    All,
    /// Renderers only: a page draws its main frame in the begin frame that asked for it, and the
    /// display ends each begin frame by Chromium's own deadline.
    Renderers,
    /// No process: Chromium's own deadlines everywhere.
    None,
}

/// What the desk runs: none (ADR 0210). With the full pipeline in the browser process, the desk's
/// page stopped for good after a resize of the app window (CEF 156 sends no begin frame while one
/// is out, and the display waited for a frame at the new size that did not come).
pub const CHOSEN: Pipeline = Pipeline::None;

impl Pipeline {
    /// The choice: [`CHOSEN`], or in a development build `DESK_FULL_PIPELINE`'s.
    pub fn now() -> Pipeline {
        static NOW: OnceLock<Pipeline> = OnceLock::new();
        *NOW.get_or_init(|| {
            let asked = std::env::var("DESK_FULL_PIPELINE").ok();
            (asked.as_deref())
                .filter(|_| cfg!(debug_assertions))
                .and_then(Pipeline::named)
                .unwrap_or(CHOSEN)
        })
    }

    /// The choice `name` names.
    pub fn named(name: &str) -> Option<Pipeline> {
        match name {
            "all" => Some(Pipeline::All),
            "renderers" => Some(Pipeline::Renderers),
            "none" => Some(Pipeline::None),
            _ => None,
        }
    }

    /// Whether the browser process's own command line takes the switch.
    pub fn in_browser(self) -> bool {
        self == Pipeline::All
    }

    /// Whether a child process of `kind` (its `--type`: `renderer`, `gpu-process`, `utility`)
    /// takes the switch at its launch.
    pub fn in_child(self, kind: &str) -> bool {
        match self {
            Pipeline::All => true,
            Pipeline::Renderers => kind == "renderer",
            Pipeline::None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Pipeline;

    #[test]
    fn renderers_only_leaves_the_browser_and_the_gpu_process_to_chromiums_deadlines() {
        let only = Pipeline::Renderers;
        assert!(!only.in_browser());
        assert!(only.in_child("renderer"));
        assert!(!only.in_child("gpu-process"));
        assert!(!only.in_child("utility"));
    }

    #[test]
    fn all_runs_it_everywhere_and_none_nowhere() {
        assert!(Pipeline::All.in_browser() && Pipeline::All.in_child("gpu-process"));
        assert!(!Pipeline::None.in_browser() && !Pipeline::None.in_child("renderer"));
    }

    #[test]
    fn a_choice_is_named_as_the_variable_names_it() {
        assert_eq!(Pipeline::named("renderers"), Some(Pipeline::Renderers));
        assert_eq!(Pipeline::named("off"), None);
    }
}
