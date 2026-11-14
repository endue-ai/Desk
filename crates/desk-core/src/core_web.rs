//! `web.*` (ADR 0216): web views, each a browser of its own that shows a remote page, drawn by the
//! shell's compositor over the calling window's surface. The core keeps no page: the shell hands it
//! a [`WebViews`] once its compositor is up, and each call asks it. The core keeps who owns each
//! view and under which `web:browse` scope: a view belongs to its caller (another caller's id is
//! `not_found`), an address outside the scope's hosts is refused here, and the shell asks
//! [`Core::web_allows`] before a view's own page goes to another address by itself (a link, a
//! redirect). What a view shows comes back through [`Core::web_changed`] as `web.changed` for its
//! caller. A view ends with `web.close`, when its plugin stops, when a grant that covered it goes,
//! and when the shell says so (its window's surface slept, went away or moved out of the desk).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::{
    BridgeEvent, ErrorCode, Permission, WebChangedData, WebChangedEvent, WebCloseParams,
    WebCloseResult, WebFocusParams, WebFocusResult, WebGoParams, WebGoResult, WebLoadParams,
    WebLoadResult, WebOpenParams, WebOpenResult, WebPlaceParams, WebPlaceResult, WebStep,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::{Target, scope_allows};

/// How many web views one caller holds at once.
pub const MAX_WEB_VIEWS: usize = 16;

/// Where a view lies in its window's surface, in CSS pixels from the surface's top left.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WebPlace {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub shown: bool,
}

/// What a view shows now.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WebState {
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    /// An address the view did not go to.
    pub refused: Option<String>,
    /// The view ended: this is its last state.
    pub closed: bool,
}

/// Why the shell could not do what a call asked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WebError {
    /// The view, or the surface it was to open in, is not on the desk.
    NotFound(String),
    /// No view can show there: the window is out of the canvas.
    Unsupported(String),
    Failed(String),
}

/// What shows web views: the shell's compositor and its web host. Called on the bridge's own
/// threads, never on the shell's event loop.
pub trait WebViews: Send + Sync {
    /// Open view `view` in the window whose surface host is `surface`, hidden, on `url` if any.
    fn open(&self, surface: &str, view: &str, url: Option<&str>) -> Result<(), WebError>;
    fn place(&self, view: &str, place: WebPlace) -> Result<(), WebError>;
    fn load(&self, view: &str, url: &str) -> Result<(), WebError>;
    fn go(&self, view: &str, step: WebStep) -> Result<(), WebError>;
    /// Give the view's page the keys.
    fn focus(&self, view: &str) -> Result<(), WebError>;
    /// Close the view; one that is gone already is no error.
    fn close(&self, view: &str);
}

struct Entry {
    caller: String,
    scope: Permission,
    surface: String,
}

/// The views callers opened, by id, and what shows them once a shell gave it.
#[derive(Default)]
pub(crate) struct Web {
    next: u64,
    entries: BTreeMap<String, Entry>,
    views: Option<Arc<dyn WebViews>>,
}

fn lock(web: &Mutex<Web>) -> MutexGuard<'_, Web> {
    web.lock().unwrap_or_else(|e| e.into_inner())
}

fn failed(why: WebError) -> desk_bridge::BridgeError {
    match why {
        WebError::NotFound(message) => error(ErrorCode::NotFound, message),
        WebError::Unsupported(message) => error(ErrorCode::Unsupported, message),
        WebError::Failed(message) => error(ErrorCode::Internal, message),
    }
}

/// The last event of view `view_id`.
fn closed(view_id: &str) -> BridgeEvent {
    changed(
        view_id,
        WebState {
            closed: true,
            ..WebState::default()
        },
    )
}

fn changed(view_id: &str, state: WebState) -> BridgeEvent {
    BridgeEvent::WebChanged(WebChangedEvent {
        event: Default::default(),
        data: WebChangedData {
            view_id: view_id.to_owned(),
            url: state.url,
            title: state.title,
            loading: state.loading,
            can_go_back: state.can_go_back,
            can_go_forward: state.can_go_forward,
            refused: state.refused,
            closed: state.closed.then_some(true),
        },
    })
}

impl Core {
    /// Show web views through `views` from now on (`None`: no compositor, `web.open` answers
    /// `unsupported`, and the views there were are forgotten with it).
    pub fn set_web_views(&self, views: Option<Arc<dyn WebViews>>) {
        let mut web = lock(&self.web);
        if views.is_none() {
            web.entries.clear();
        }
        web.views = views;
    }

    /// The shell's views and the caller's entry for `view`: its surface and its scope.
    fn web_view(
        &self,
        caller: &str,
        view: &str,
    ) -> Result<Arc<dyn WebViews>, desk_bridge::BridgeError> {
        let web = lock(&self.web);
        let owned = web.entries.get(view).is_some_and(|e| e.caller == caller);
        match (&web.views, owned) {
            (Some(views), true) => Ok(Arc::clone(views)),
            _ => Err(error(
                ErrorCode::NotFound,
                format!("{caller} has no web view {view}"),
            )),
        }
    }

    pub(crate) fn web_open(&self, caller: &str, params: WebOpenParams) -> Answer {
        let scope = Permission::WebBrowse(params.scope);
        let target = params.url.as_deref().map_or(Target::None, Target::Url);
        self.check(caller, &scope, &target)?;
        let surface = params.surface.ok_or_else(|| {
            error(
                ErrorCode::InvalidParams,
                "web.open names the window's surface (the runtime sets it)".to_owned(),
            )
        })?;
        let (views, view_id, before) = {
            let mut web = lock(&self.web);
            let views = web.views.clone().ok_or_else(|| {
                error(
                    ErrorCode::Unsupported,
                    "this desk has no compositor to show a web view".to_owned(),
                )
            })?;
            // A window has one view: the one it had closes.
            let before: Vec<String> = (web.entries.iter())
                .filter(|(_, e)| e.caller == caller && e.surface == surface)
                .map(|(id, _)| id.clone())
                .collect();
            for id in &before {
                web.entries.remove(id);
            }
            let held = (web.entries.values())
                .filter(|e| e.caller == caller)
                .count();
            if held >= MAX_WEB_VIEWS {
                return Err(error(
                    ErrorCode::InvalidValue,
                    format!("{caller} already holds {MAX_WEB_VIEWS} web views"),
                ));
            }
            web.next += 1;
            let view_id = format!("w-{}", web.next);
            let entry = Entry {
                caller: caller.to_owned(),
                scope,
                surface: surface.clone(),
            };
            web.entries.insert(view_id.clone(), entry);
            (views, view_id, before)
        };
        for id in &before {
            views.close(id);
            self.events()
                .publish_to(vec![caller.to_owned()], closed(id));
        }
        if let Err(why) = views.open(&surface, &view_id, params.url.as_deref()) {
            lock(&self.web).entries.remove(&view_id);
            return Err(failed(why));
        }
        json(WebOpenResult { view_id })
    }

    pub(crate) fn web_place(&self, caller: &str, params: WebPlaceParams) -> Answer {
        let views = self.web_view(caller, &params.view_id)?;
        let place = WebPlace {
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height,
            shown: params.shown != Some(false),
        };
        views.place(&params.view_id, place).map_err(failed)?;
        json(WebPlaceResult {})
    }

    pub(crate) fn web_load(&self, caller: &str, params: WebLoadParams) -> Answer {
        let scope = Permission::WebBrowse(params.scope);
        self.check(caller, &scope, &Target::Url(&params.url))?;
        let views = self.web_view(caller, &params.view_id)?;
        views.load(&params.view_id, &params.url).map_err(failed)?;
        json(WebLoadResult {})
    }

    pub(crate) fn web_go(&self, caller: &str, params: WebGoParams) -> Answer {
        let views = self.web_view(caller, &params.view_id)?;
        views.go(&params.view_id, params.to).map_err(failed)?;
        json(WebGoResult {})
    }

    pub(crate) fn web_focus(&self, caller: &str, params: WebFocusParams) -> Answer {
        let views = self.web_view(caller, &params.view_id)?;
        views.focus(&params.view_id).map_err(failed)?;
        json(WebFocusResult {})
    }

    /// Closing a view that already ended is no error; another caller's is left alone.
    pub(crate) fn web_close(&self, caller: &str, params: WebCloseParams) -> Answer {
        let views = {
            let mut web = lock(&self.web);
            let owned = (web.entries.get(&params.view_id)).is_some_and(|e| e.caller == caller);
            if owned {
                web.entries.remove(&params.view_id);
            }
            web.views.clone().filter(|_| owned)
        };
        if let Some(views) = views {
            views.close(&params.view_id);
            let event = closed(&params.view_id);
            self.events().publish_to(vec![caller.to_owned()], event);
        }
        json(WebCloseResult {})
    }

    /// Whether view `view`'s own page may go to `url` by itself: an http or https address on a host
    /// one of its caller's `web:browse` grants covers. The shell asks before each such step.
    pub fn web_allows(&self, view: &str, url: &str) -> bool {
        let web = lock(&self.web);
        let Some(entry) = web.entries.get(view) else {
            return false;
        };
        let grants = self.permissions().grants(&entry.caller);
        http(url)
            && (grants.iter()).any(|g| {
                matches!(g.permission, Permission::WebBrowse(_))
                    && scope_allows(&g.permission, &Target::Url(url))
            })
    }

    /// View `view` shows something else now: its caller hears `web.changed`. A state that says
    /// `closed` is its last: the core forgets the view.
    pub fn web_changed(&self, view: &str, state: WebState) {
        let caller = {
            let mut web = lock(&self.web);
            let caller = web.entries.get(view).map(|e| e.caller.clone());
            if state.closed {
                web.entries.remove(view);
            }
            caller
        };
        if let Some(caller) = caller {
            self.events().publish_to(vec![caller], changed(view, state));
        }
    }

    /// Close the views `gone` picks of `caller`'s; each hears its last `web.changed` if `tell`.
    fn end_web(&self, caller: &str, tell: bool, gone: impl Fn(&Core, &Permission) -> bool) {
        let (views, ended) = {
            let mut web = lock(&self.web);
            let ended: Vec<String> = (web.entries.iter())
                .filter(|(_, e)| e.caller == caller && gone(self, &e.scope))
                .map(|(id, _)| id.clone())
                .collect();
            for id in &ended {
                web.entries.remove(id);
            }
            (web.views.clone(), ended)
        };
        for id in &ended {
            if let Some(views) = &views {
                views.close(id);
            }
            if tell {
                self.events()
                    .publish_to(vec![caller.to_owned()], closed(id));
            }
        }
    }

    /// The caller stopped: its views close.
    pub(crate) fn drop_web(&self, caller: &str) {
        self.end_web(caller, false, |_, _| true);
    }

    /// Close the caller's views that none of its grants covers any more.
    pub(crate) fn prune_web(&self, caller: &str) {
        self.end_web(caller, true, |core, scope| {
            let permissions = core.permissions();
            permissions.authorize(caller, scope, &Target::None).is_err()
        });
    }

    /// How many web views are open, for tests and diagnostics.
    pub fn web_view_count(&self) -> usize {
        lock(&self.web).entries.len()
    }
}

/// Whether `url` is an http or https address.
fn http(url: &str) -> bool {
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}
