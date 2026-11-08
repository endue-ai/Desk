//! The platform interface. Reads are open to whoever holds a `Computer`; acts take a `Permit`, which
//! only `Control` makes, after the guard, the stop flag and the rate limit let the act through.

use std::sync::Arc;

use crate::Error;
use crate::apps::{App, AppOp, Launch};
use crate::ax::{AxAction, Budget, Element, ElementRef, Query, Setting, Tree};
use crate::input::Event;
use crate::permissions::{Permission, Permissions};
use crate::screen::{Capture, Display, Screenshot, Window, WindowScope};

/// Proof that `Control` let an act through. It cannot be made outside this crate, so no caller
/// reaches a `Computer`'s acting methods around the guard; implementations only receive it.
#[derive(Debug)]
pub struct Permit {
    _private: (),
}

impl Permit {
    pub(crate) fn new() -> Self {
        Self { _private: () }
    }
}

/// Where keyboard input goes now.
#[derive(Debug, Clone, PartialEq)]
pub struct Focus {
    /// The frontmost app.
    pub app: App,
    /// Its focused window (`AXFocusedWindow`), when it has one.
    pub window: Option<Element>,
    /// The focused element (`AXFocusedUIElement`), with its path, when there is one.
    pub element: Option<Element>,
}

/// One computer's screens, interfaces, input and apps. Every call answers `unsupported` where the
/// platform has none, and `permission_denied` (naming the System Settings pane) when the OS has not
/// granted what it needs: Accessibility for the AX calls and input, Screen Recording for
/// screenshots. Calls block; none needs the main thread.
pub trait Computer: Send + Sync {
    /// What the OS allows now. Never prompts.
    fn permissions(&self) -> Result<Permissions, Error>;
    /// Ask the OS for `permission`, showing its prompt if the person was never asked. Answers at
    /// once with whether it is granted now; a grant the person gives later shows in `permissions`.
    fn request(&self, permission: Permission) -> Result<bool, Error>;
    /// Open the System Settings pane that grants `permission`.
    fn open_settings(&self, permission: Permission) -> Result<(), Error>;

    /// The active displays, the main one first.
    fn displays(&self) -> Result<Vec<Display>, Error>;
    /// The windows of every app, front to back. Titles need Screen Recording.
    fn windows(&self, scope: WindowScope) -> Result<Vec<Window>, Error>;
    /// A screenshot as PNG. `not_found` for a display or window that is gone.
    fn screenshot(&self, capture: &Capture) -> Result<Screenshot, Error>;

    /// The frontmost app, its focused window and focused element.
    fn focused(&self) -> Result<Focus, Error>;
    /// The elements below `root` within `budget`. `not_found` when the root is gone or its role
    /// is not the one `root` expects.
    fn tree(&self, root: &ElementRef, budget: Budget) -> Result<Tree, Error>;
    /// The elements below `root` (itself included) that `query` matches, nearest first.
    fn find(&self, root: &ElementRef, query: &Query, budget: Budget)
    -> Result<Vec<Element>, Error>;
    /// The running apps.
    fn apps(&self) -> Result<Vec<App>, Error>;

    /// Post one input event.
    fn post(&self, event: &Event, permit: &Permit) -> Result<(), Error>;
    /// Perform an AX action. Answers the element as it was before; `invalid_params` when it does
    /// not offer the action.
    fn perform(
        &self,
        element: &ElementRef,
        action: AxAction,
        permit: &Permit,
    ) -> Result<Element, Error>;
    /// Set an attribute. Answers the element afterwards; `invalid_params` when it is not settable.
    fn set(
        &self,
        element: &ElementRef,
        setting: &Setting,
        permit: &Permit,
    ) -> Result<Element, Error>;
    /// Launch an app, or bring it forward when it runs; answers it once it runs.
    fn launch(&self, launch: &Launch, permit: &Permit) -> Result<App, Error>;
    /// Activate, hide or quit a running app; answers it as it was asked.
    fn app(&self, pid: i32, op: AppOp, permit: &Permit) -> Result<App, Error>;
}

/// This computer: macOS's Accessibility, CGEvent, ScreenCaptureKit and NSWorkspace.
#[cfg(target_os = "macos")]
pub fn os() -> Arc<dyn Computer> {
    Arc::new(crate::macos::MacOs::new())
}

/// This computer: every call answers `unsupported` off macOS for now.
#[cfg(not(target_os = "macos"))]
pub fn os() -> Arc<dyn Computer> {
    Arc::new(crate::unsupported::Unsupported)
}
