//! The native host where the desk has no transport for native plugins yet (Windows, until #61 gives
//! it named pipes and imports D3D11 handles from another process): each native plugin's surface is
//! `died` with `launch-failed` as soon as it is made, so its window says it could not start.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use desk_bridge::PluginKind;
use desk_surface::generated::{
    CompositorMessage, SurfaceDeathReason, SurfaceDied, SurfaceDiedType, SurfaceMessage,
};
use serde_json::{Value, json};

use crate::host::Desk;
use crate::web_host::SurfaceSink;
use crate::web_host::lifecycle::surface_of;
use crate::web_host::relay::Relay;

#[derive(Clone)]
pub struct NativeHost {
    surfaces: Arc<Mutex<HashSet<String>>>,
    sink: Arc<dyn SurfaceSink>,
    desk: Arc<Desk>,
}

impl NativeHost {
    pub fn new(sink: Arc<dyn SurfaceSink>, _relay: Relay, desk: Arc<Desk>) -> NativeHost {
        NativeHost {
            surfaces: Arc::default(),
            sink,
            desk,
        }
    }

    pub fn owns(&self, surface: &str) -> bool {
        (self.surfaces.lock().unwrap_or_else(|e| e.into_inner())).contains(surface)
    }

    pub fn send(&self, message: &CompositorMessage) -> bool {
        let Some(surface) = surface_of(message) else {
            return false;
        };
        let native = |plugin: &str| {
            (self.desk.core.plugins().iter()).any(|p| {
                p.id == plugin
                    && p.manifest
                        .as_ref()
                        .is_some_and(|m| m.kind == PluginKind::Native)
            })
        };
        if let CompositorMessage::SurfaceCreate(create) = message
            && native(&create.plugin)
        {
            (self.surfaces.lock().unwrap_or_else(|e| e.into_inner())).insert(surface.clone());
        }
        if !self.owns(&surface) {
            return false;
        }
        if matches!(
            message,
            CompositorMessage::SurfaceCreate(_) | CompositorMessage::SurfaceWake(_)
        ) {
            self.sink.message(SurfaceMessage::SurfaceDied(SurfaceDied {
                r#type: SurfaceDiedType::Died,
                surface,
                reason: SurfaceDeathReason::LaunchFailed,
                exit_code: None,
            }));
        }
        true
    }

    pub fn load(&self, surface: &str) -> bool {
        self.owns(surface)
    }

    pub fn close_all(&self) {}

    pub fn stats(&self) -> Value {
        json!({})
    }
}
