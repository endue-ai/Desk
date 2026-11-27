//! Calls from the core to the native host that owns the Browser's web views.

use desk_bridge::{WebActResult, WebAction, WebReadResult, WebStep};

use super::WebPlace;

/// Why the shell could not do what a call asked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WebError {
    /// The view, or the surface it was to open in, is not on the desk.
    NotFound(String),
    /// No view can show there: the window is out of the canvas.
    Unsupported(String),
    /// The page cannot take what was asked: text into a button, an option a list does not have.
    Invalid(String),
    /// The page or history entry changed before the requested action could run.
    Changed(String),
    Failed(String),
}

/// The particular CEF history destination inspected before a traversal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebHistoryTarget {
    pub url: String,
    pub current: i32,
    pub index: i32,
    pub completion: i64,
    pub has_post_data: bool,
    /// Chromium's stable id for a history traversal. Reload uses the current entry.
    pub entry_id: Option<i64>,
}

impl WebHistoryTarget {
    /// Compare the entry observed through CEF, which exposes its position but not its id.
    pub fn same_position(&self, other: &Self) -> bool {
        self.current == other.current
            && self.index == other.index
            && self.url == other.url
            && self.completion == other.completion
            && self.has_post_data == other.has_post_data
    }
}

/// What shows web views: the shell's compositor and its web host. Called on the bridge's own
/// threads, never on the shell's event loop.
pub trait WebViews: Send + Sync {
    /// Open view `view` in the window whose surface host is `surface`, hidden, on `url` if any.
    fn open(&self, surface: &str, view: &str, url: Option<&str>) -> Result<(), WebError>;
    fn place(&self, view: &str, place: WebPlace) -> Result<(), WebError>;
    fn load(&self, view: &str, url: &str) -> Result<(), WebError>;
    fn go(&self, view: &str, step: WebStep) -> Result<(), WebError>;
    /// Inspect the exact native destination. None means there is no entry in that direction.
    fn history_target(
        &self,
        _view: &str,
        _at: &str,
        _step: WebStep,
    ) -> Result<Option<WebHistoryTarget>, WebError> {
        Err(WebError::Unsupported(
            "history inspection is unavailable".into(),
        ))
    }
    /// Traverse only if the inspected native destination is still current for this step.
    fn go_history(
        &self,
        _view: &str,
        _at: &str,
        _step: WebStep,
        _expected: &WebHistoryTarget,
    ) -> Result<(), WebError> {
        Err(WebError::Unsupported(
            "guarded history is unavailable".into(),
        ))
    }
    /// Give the view's page the keys.
    fn focus(&self, view: &str) -> Result<(), WebError>;
    /// Read the page of view `view`: the part of its text from character `from` on, `max`
    /// characters at most. `at` is the address the core allowed the read at: a page of another
    /// origin by now is not read (`NotFound`).
    fn read(&self, view: &str, at: &str, from: u64, max: u64) -> Result<WebReadResult, WebError>;
    /// Do `action` in the page of view `view` as a person's input would, without giving the view
    /// the keys. `at` as for `read`.
    fn act(&self, view: &str, at: &str, action: &WebAction) -> Result<WebActResult, WebError>;
    /// Close the view; one that is gone already is no error.
    fn close(&self, view: &str);
}
