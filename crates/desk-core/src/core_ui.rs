//! The ui side of `Core`: ui.notify passes the permission engine and reaches the runtime as a
//! `ui.notified` event. How long it shows, and whether do-not-disturb holds it, is the runtime's
//! notify policy (ADR 0017). ui.surface.open and ui.surface.close keep the open surfaces per caller:
//! a caller opens only what its manifest declares, the runtime hears `ui.surface.opened` and
//! `ui.surface.closed` and mounts as its display policy says, and a plugin turned off closes its
//! surfaces. Losing `ui:surface` closes nothing: open surfaces are the person's windows.

use std::sync::MutexGuard;
use std::sync::atomic::Ordering;

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, NotifyLevel, Permission, Surface, UiNotifiedData,
    UiNotifiedEvent, UiNotifyParams, UiNotifyResult, UiSurfaceCloseParams, UiSurfaceCloseResult,
    UiSurfaceClosedData, UiSurfaceClosedEvent, UiSurfaceOpenParams, UiSurfaceOpenResult,
    UiSurfaceOpenedData, UiSurfaceOpenedEvent,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// The caller the runtime calls as, which mounts surfaces.
const RUNTIME: &str = "desk";

struct OpenSurface {
    handle: String,
    caller: String,
    surface: String,
}

/// The surfaces callers opened, in the order they opened them.
#[derive(Default)]
pub(crate) struct Surfaces {
    next: u64,
    open: Vec<OpenSurface>,
}

impl Core {
    pub(crate) fn notify(&self, caller: &str, params: UiNotifyParams) -> Answer {
        let scope = Permission::UiNotify(params.scope);
        self.check(caller, &scope, &Target::None)?;
        let n = self.notifications.fetch_add(1, Ordering::Relaxed) + 1;
        let notification_id = format!("n-{n}");
        self.events()
            .publish(BridgeEvent::UiNotified(UiNotifiedEvent {
                event: Default::default(),
                data: UiNotifiedData {
                    notification_id: notification_id.clone(),
                    caller: caller.to_owned(),
                    title: params.title,
                    body: params.body,
                    level: params.level.unwrap_or(NotifyLevel::Info),
                },
            }));
        json(UiNotifyResult { notification_id })
    }

    /// Open a surface the caller's manifest declares, at the call's placement and title, else the
    /// manifest's. An open surface opens again under another handle.
    pub(crate) fn surface_open(&self, caller: &str, params: UiSurfaceOpenParams) -> Answer {
        self.check(caller, &Permission::UiSurface(params.scope), &Target::None)?;
        let declared = self.declared_surface(caller, &params.surface)?;
        let mut surfaces = self.surfaces();
        surfaces.next += 1;
        let handle = format!("s-{}", surfaces.next);
        surfaces.open.push(OpenSurface {
            handle: handle.clone(),
            caller: caller.to_owned(),
            surface: declared.id.clone(),
        });
        // Under the table's lock, so the runtime never hears a close before its open.
        self.events().publish_to(
            vec![RUNTIME.to_owned()],
            BridgeEvent::UiSurfaceOpened(UiSurfaceOpenedEvent {
                event: Default::default(),
                data: UiSurfaceOpenedData {
                    handle: handle.clone(),
                    caller: caller.to_owned(),
                    surface: declared.id,
                    placement: params.placement.unwrap_or(declared.placement),
                    title: params.title.or(declared.title),
                },
            }),
        );
        drop(surfaces);
        json(UiSurfaceOpenResult { handle })
    }

    /// Close one of the caller's surfaces; another caller's handle, or one already closed, is
    /// `not_found`.
    pub(crate) fn surface_close(&self, caller: &str, params: UiSurfaceCloseParams) -> Answer {
        self.check(caller, &Permission::UiSurface(params.scope), &Target::None)?;
        let mut surfaces = self.surfaces();
        let index = surfaces
            .open
            .iter()
            .position(|s| s.handle == params.handle && s.caller == caller)
            .ok_or_else(|| {
                error(
                    ErrorCode::NotFound,
                    format!("{caller} has no surface {}", params.handle),
                )
            })?;
        let closed = surfaces.open.remove(index);
        self.surface_closed(closed);
        drop(surfaces);
        json(UiSurfaceCloseResult {})
    }

    /// The caller unloaded: its surfaces close, each with its `ui.surface.closed`.
    pub(crate) fn drop_surfaces(&self, caller: &str) {
        let mut surfaces = self.surfaces();
        let (closed, kept) = std::mem::take(&mut surfaces.open)
            .into_iter()
            .partition(|s| s.caller == caller);
        surfaces.open = kept;
        for surface in closed {
            self.surface_closed(surface);
        }
    }

    /// How many surfaces are open, for tests and diagnostics.
    pub fn surface_count(&self) -> usize {
        self.surfaces().open.len()
    }

    /// The surface `id` as the caller's manifest declares it. Only a plugin that is running has one:
    /// the runtime (`desk`) and the CLI have no manifest.
    fn declared_surface(&self, caller: &str, id: &str) -> Result<Surface, BridgeError> {
        let invalid = |why: String| error(ErrorCode::InvalidParams, why);
        let plugin = self
            .plugins()
            .into_iter()
            .find(|plugin| plugin.id == caller)
            .ok_or_else(|| invalid(format!("{caller} has no manifest that declares surfaces")))?;
        if !self.running(caller) {
            return Err(invalid(format!("{caller} is not running")));
        }
        plugin
            .manifest
            .and_then(|manifest| manifest.surfaces)
            .unwrap_or_default()
            .into_iter()
            .find(|surface| surface.id == id)
            .ok_or_else(|| invalid(format!("{caller} declares no surface {id}")))
    }

    fn surface_closed(&self, surface: OpenSurface) {
        self.events().publish_to(
            vec![RUNTIME.to_owned()],
            BridgeEvent::UiSurfaceClosed(UiSurfaceClosedEvent {
                event: Default::default(),
                data: UiSurfaceClosedData {
                    handle: surface.handle,
                    caller: surface.caller,
                    surface: surface.surface,
                },
            }),
        );
    }

    fn surfaces(&self) -> MutexGuard<'_, Surfaces> {
        self.surfaces
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
