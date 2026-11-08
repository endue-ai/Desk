//! What computer:see reads (ADR 0123): the OS permissions, screenshots, displays and windows, the
//! running apps and the accessibility tree. A scope's apps leave the other apps out of listings and
//! refuse their windows and trees; a display or a region needs a scope without apps.

use base64::Engine as _;
use desk_bridge::{
    BridgeError, ComputerAppsListResult, ComputerAxFindParams, ComputerAxFindResult,
    ComputerAxTreeParams, ComputerAxTreeResult, ComputerPermissionParams,
    ComputerPermissionsOpenResult, ComputerPermissionsRequestResult,
    ComputerPermissionsStatusResult, ComputerScreenshotParams, ComputerScreenshotResult,
    ComputerSeeParams, ComputerSeePermission, ComputerWindowsParams, ComputerWindowsResult,
    ErrorCode, Permission,
};
use desk_computer::ax::{Budget, ElementRef, Query};
use desk_computer::screen::{Capture, Target as Shot, WindowScope};
use desk_computer::{Computer, Focus};

use super::{app_of, map};
use crate::handler::{Answer, Core, error, json, sys_error};
use crate::perm::Target;

/// Whether a see scope holds the app with `bundle`: every app without a list.
fn holds(scope: &ComputerSeePermission, bundle: Option<&str>) -> bool {
    scope
        .apps
        .as_ref()
        .is_none_or(|apps| bundle.is_some_and(|b| apps.iter().any(|a| a == b)))
}

impl Core {
    /// The driver for a read `caller` makes under `scope`, for the app with `bundle` (or for
    /// listings, which the scope narrows, with `Target::None`).
    fn seeing(
        &self,
        caller: &str,
        scope: &ComputerSeePermission,
        target: Target<'_>,
    ) -> Result<std::sync::Arc<dyn Computer>, BridgeError> {
        let computer = self.computer.computer()?;
        self.check(caller, &Permission::ComputerSee(scope.clone()), &target)?;
        Ok(computer)
    }

    pub(crate) fn computer_status(&self, caller: &str, params: ComputerSeeParams) -> Answer {
        let computer = self.seeing(caller, &params.scope, Target::None)?;
        let now = computer.permissions().map_err(sys_error)?;
        json(ComputerPermissionsStatusResult {
            accessibility: now.accessibility,
            screen_recording: now.screen_recording,
            bundle_id: now.bundle_id,
            stopped: self.computer.stop_flag().is_raised(),
        })
    }

    pub(crate) fn computer_request(
        &self,
        caller: &str,
        params: ComputerPermissionParams,
    ) -> Answer {
        let computer = self.seeing(caller, &params.scope, Target::None)?;
        let permission = map::os_permission(params.permission);
        let granted = computer.request(permission).map_err(sys_error)?;
        json(ComputerPermissionsRequestResult { granted })
    }

    pub(crate) fn computer_open(&self, caller: &str, params: ComputerPermissionParams) -> Answer {
        let computer = self.seeing(caller, &params.scope, Target::None)?;
        let permission = map::os_permission(params.permission);
        computer.open_settings(permission).map_err(sys_error)?;
        json(ComputerPermissionsOpenResult::new())
    }

    pub(crate) fn computer_screenshot(
        &self,
        caller: &str,
        params: ComputerScreenshotParams,
    ) -> Answer {
        let target = map::target(params.target.as_ref())?;
        let computer = self.computer.computer()?;
        // A window is its app's; a display or a region shows every app on it.
        let bundle = match target {
            Shot::Window(id) => {
                let windows = computer.windows(WindowScope::All).map_err(sys_error)?;
                let window = windows.into_iter().find(|w| w.id == id).ok_or_else(|| {
                    error(ErrorCode::NotFound, format!("there is no window {id}"))
                })?;
                window.bundle_id
            }
            _ => None,
        };
        self.seeing(caller, &params.scope, Target::App(bundle.as_deref()))?;
        let capture = Capture {
            target,
            max_width: params.max_width.map(clamp),
            max_height: params.max_height.map(clamp),
        };
        let shot = computer.screenshot(&capture).map_err(sys_error)?;
        json(ComputerScreenshotResult {
            image: base64::engine::general_purpose::STANDARD.encode(&shot.png),
            media_type: Default::default(),
            width: u64::from(shot.width),
            height: u64::from(shot.height),
            scale: shot.scale,
            bounds: map::rect(shot.bounds),
        })
    }

    pub(crate) fn computer_windows(&self, caller: &str, params: ComputerWindowsParams) -> Answer {
        let computer = self.seeing(caller, &params.scope, Target::None)?;
        let scope = if params.all == Some(true) {
            WindowScope::All
        } else {
            WindowScope::OnScreen
        };
        let windows = computer.windows(scope).map_err(sys_error)?;
        let displays = computer.displays().map_err(sys_error)?;
        json(ComputerWindowsResult {
            displays: displays.into_iter().map(map::display).collect(),
            windows: windows
                .into_iter()
                .filter(|w| holds(&params.scope, w.bundle_id.as_deref()))
                .map(map::window)
                .collect(),
        })
    }

    pub(crate) fn computer_apps(&self, caller: &str, params: ComputerSeeParams) -> Answer {
        let computer = self.seeing(caller, &params.scope, Target::None)?;
        let apps = computer.apps().map_err(sys_error)?;
        json(ComputerAppsListResult {
            apps: apps
                .into_iter()
                .filter(|a| holds(&params.scope, a.bundle_id.as_deref()))
                .map(map::app)
                .collect(),
        })
    }

    pub(crate) fn computer_tree(&self, caller: &str, params: ComputerAxTreeParams) -> Answer {
        let (computer, root) = self.root(caller, &params.scope, params.root.as_ref())?;
        let budget = Budget::new(
            params.depth.map_or(10, clamp),
            params.nodes.map_or(500, clamp),
        );
        let tree = computer.tree(&root, budget.clamped()).map_err(sys_error)?;
        let app = app_of(computer.as_ref(), tree.pid)?;
        let nodes = tree
            .root
            .flatten()
            .into_iter()
            .map(|node| map::element(node.element.clone(), node.child_count))
            .collect();
        json(ComputerAxTreeResult {
            pid: i64::from(tree.pid),
            app: app.map(map::app),
            nodes,
            truncated: tree.truncated,
        })
    }

    pub(crate) fn computer_find(&self, caller: &str, params: ComputerAxFindParams) -> Answer {
        let (computer, root) = self.root(caller, &params.scope, params.root.as_ref())?;
        let query = Query {
            role: params.role,
            title: params.title,
            exact: params.exact == Some(true),
            limit: params.limit.map_or(20, clamp),
        };
        let budget = Budget::new(
            params.depth.map_or(10, clamp),
            params.nodes.map_or(500, clamp),
        );
        let found = computer
            .find(&root, &query, budget.clamped())
            .map_err(sys_error)?;
        json(ComputerAxFindResult {
            pid: i64::from(root.pid),
            elements: found.into_iter().map(|e| map::element(e, None)).collect(),
        })
    }

    /// The root a tree or a find starts at, checked against the scope's apps: the one given, else
    /// the frontmost app's focused window, else that app.
    fn root(
        &self,
        caller: &str,
        scope: &ComputerSeePermission,
        given: Option<&desk_bridge::ComputerElementRef>,
    ) -> Result<(std::sync::Arc<dyn Computer>, ElementRef), BridgeError> {
        let computer = self.computer.computer()?;
        let root = match given {
            Some(given) => map::element_ref(given)?,
            None => {
                let Focus { app, window, .. } = computer.focused().map_err(sys_error)?;
                window.map_or_else(|| ElementRef::app(app.pid), |w| w.reference(app.pid))
            }
        };
        let app = app_of(computer.as_ref(), root.pid)?;
        let bundle = app.and_then(|a| a.bundle_id);
        let computer = self.seeing(caller, scope, Target::App(bundle.as_deref()))?;
        Ok((computer, root))
    }
}

/// A bridge count as the driver's, already bounded by the schema.
fn clamp(n: u64) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}
