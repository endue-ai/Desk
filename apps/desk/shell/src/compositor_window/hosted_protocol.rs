//! The hosted desk's words with the surfaces: a step as the protocol's message (`specs/surface/v0`),
//! and the plugin and surface a surface host names.

use desk_surface::generated::CompositorMessage;
use desk_wm::Step;
use serde_json::json;

/// A step as the protocol's message; `None` for a load, which is the web host's own.
pub fn message(step: &Step) -> Option<CompositorMessage> {
    let size = |(w, h): (u32, u32)| json!({ "width": w, "height": h });
    let value = match step {
        Step::Load { .. } => return None,
        Step::Create {
            surface,
            plugin,
            view,
            size: s,
            scale,
            hidden,
        } => json!({ "type": "create", "surface": surface, "plugin": plugin, "view": view,
            "size": size(*s), "scale": scale, "format": "bgra8", "hidden": hidden }),
        Step::Resize {
            surface,
            size: s,
            scale,
        } => json!({ "type": "resize", "surface": surface, "size": size(*s), "scale": scale }),
        Step::Wake {
            surface,
            size: s,
            scale,
        } => json!({ "type": "wake", "surface": surface, "size": size(*s), "scale": scale }),
        Step::Show { surface } => json!({ "type": "show", "surface": surface }),
        Step::Hide { surface } => json!({ "type": "hide", "surface": surface }),
        Step::Sleep { surface } => json!({ "type": "sleep", "surface": surface }),
        Step::Destroy { surface } => json!({ "type": "destroy", "surface": surface }),
    };
    serde_json::from_value(value).ok()
}

/// The plugin id and the manifest's surface a surface host names.
pub fn owner(host: &str) -> Option<(String, String)> {
    match desk_web::plugin_scheme::hosts::Host::parse(Some(host))? {
        desk_web::plugin_scheme::hosts::Host::Surface {
            surface, plugin, ..
        } => Some((plugin, surface.to_owned())),
        _ => None,
    }
}
