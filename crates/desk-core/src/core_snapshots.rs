//! `ui.surface.snapshot` (#54, ADR 0161): a PNG of a surface's last frame as the compositor holds
//! it, for Eris, agents and tests. The core keeps no pixels: the shell that composites the surfaces
//! hands it a [`SurfaceSnapshots`] once its compositor is up, and each call asks it. The caller rule
//! is ADR 0012's: a plugin calls only as itself, so it snapshots only its own surfaces; a caller
//! without a manifest (the runtime `desk`, which Eris speaks through, an agent, the CLI) snapshots
//! any surface. Every call needs `ui:surface`.

use std::sync::{Arc, Mutex};

use base64::Engine;
use desk_bridge::{
    BridgeError, ErrorCode, Permission, UiSurfaceSnapshotParams, UiSurfaceSnapshotResult,
};

use crate::agents::agent_of;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// The callers with no manifest of their own: the runtime, the CLI and desk-core itself. Agents
/// (`agent:<id>`) are told apart by their prefix.
const NO_MANIFEST: [&str; 3] = ["desk", "cli", "core"];

/// A surface's frame as a PNG: its pixels, its scale (pixels per CSS pixel) and whether it is the
/// frame from before the surface slept.
#[derive(Clone, Debug, PartialEq)]
pub struct SurfaceShot {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub asleep: bool,
}

/// Why a snapshot could not be taken.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShotError {
    /// The surface is not on the desk, or has shown no frame yet.
    NotFound(String),
    /// The compositor could not read it back.
    Failed(String),
}

/// What takes snapshots: the shell's compositor. Called on the bridge's own threads, never on the
/// shell's event loop.
pub trait SurfaceSnapshots: Send + Sync {
    /// Plugin `plugin`'s surface `surface` (its manifest's id), at most `max` pixels on each side
    /// that is given, its aspect ratio kept and never enlarged.
    fn snapshot(
        &self,
        plugin: &str,
        surface: &str,
        max: (Option<u32>, Option<u32>),
    ) -> Result<SurfaceShot, ShotError>;
}

/// The snapshots' source, once a shell gave one.
#[derive(Default)]
pub(crate) struct Snapshots(Mutex<Option<Arc<dyn SurfaceSnapshots>>>);

impl Snapshots {
    fn source(&self) -> Option<Arc<dyn SurfaceSnapshots>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

/// Whether `caller` may snapshot another caller's surfaces: it has no manifest of its own.
fn sees_every_surface(caller: &str) -> bool {
    NO_MANIFEST.contains(&caller) || agent_of(caller).is_some()
}

impl Core {
    /// Take snapshots through `source` from now on (`None`: no compositor, every call answers
    /// `unsupported`).
    pub fn set_surface_snapshots(&self, source: Option<Arc<dyn SurfaceSnapshots>>) {
        *self.snapshots.0.lock().unwrap_or_else(|e| e.into_inner()) = source;
    }

    pub(crate) fn surface_snapshot(&self, caller: &str, params: UiSurfaceSnapshotParams) -> Answer {
        let scope = Permission::UiSurface(params.scope);
        self.check(caller, &scope, &Target::None)?;
        if params.plugin.as_str() != caller && !sees_every_surface(caller) {
            return Err(BridgeError {
                code: ErrorCode::PermissionDenied,
                message: format!("{caller} may snapshot only its own surfaces"),
                permission: Some(scope),
            });
        }
        let source = self.snapshots.source().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no compositor to take snapshots".to_owned(),
            )
        })?;
        let surface = params.surface.as_deref().unwrap_or("main");
        let max = |v: Option<u64>| v.map(|v| v.clamp(1, 8192) as u32);
        let shot = source
            .snapshot(
                params.plugin.as_str(),
                surface,
                (max(params.max_width), max(params.max_height)),
            )
            .map_err(|why| match why {
                ShotError::NotFound(message) => error(ErrorCode::NotFound, message),
                ShotError::Failed(message) => error(ErrorCode::Internal, message),
            })?;
        json(UiSurfaceSnapshotResult {
            image: base64::engine::general_purpose::STANDARD.encode(&shot.png),
            media_type: Default::default(),
            width: u64::from(shot.width.max(1)),
            height: u64::from(shot.height.max(1)),
            scale: shot.scale,
            asleep: shot.asleep,
        })
    }
}
