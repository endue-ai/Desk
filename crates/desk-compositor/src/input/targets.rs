//! Which surface a scene node shows, and how its units map to that surface's logical pixels. The
//! window manager registers each surface quad it inserts; the hit test (`hit.rs`) finds the node
//! under the pointer through every transform, and this turns the point into the surface's own
//! coordinates. Each surface also keeps one mapping for points off its quads: a press's capture
//! follows the pointer outside the surface, and a caret goes back to the screen for the IME.

use std::collections::HashMap;

use glam::{Mat4, Vec2, Vec3};

use crate::hit::hit_test;
use crate::node::NodeId;
use crate::scene::Scene;

/// What a node shows: part of surface `surface`, whose point `origin` is at the node's top left,
/// `per_unit` surface pixels to one of the node's units.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub surface: String,
    pub origin: Vec2,
    pub per_unit: Vec2,
}

/// What is under a point.
#[derive(Clone, Debug, PartialEq)]
pub enum Under {
    /// A surface, at its own logical point.
    Surface { surface: String, at: Vec2 },
    /// An overlay of the compositor's that takes the pointer (it is active).
    Overlay { name: String, at: Vec2 },
    /// The compositor's own chrome.
    Chrome(NodeId),
}

#[derive(Clone, Debug)]
struct Mapping {
    node: NodeId,
    /// The node's world transform and inverse, its rectangle's top left.
    world: Mat4,
    inverse: Mat4,
    min: Vec2,
    target: Target,
}

/// The nodes that show surfaces and overlays, and who owns each surface.
#[derive(Clone, Debug, Default)]
pub struct Targets {
    nodes: HashMap<NodeId, Target>,
    overlays: HashMap<NodeId, String>,
    maps: HashMap<String, Mapping>,
    owners: HashMap<String, String>,
}

impl Targets {
    /// Forget every node (the scene is laid out again); owners and the last mappings stay.
    pub fn clear(&mut self) {
        self.nodes.clear();
        self.overlays.clear();
    }

    /// Node `node` of `scene` shows `target`.
    pub fn surface(&mut self, scene: &Scene, node: NodeId, target: Target) {
        if let (Some(world), Some(rect)) = (
            scene.world_transform(node),
            scene.node(node).and_then(|n| n.rect()),
        ) && world.determinant().abs() > 1e-12
        {
            let mapping = Mapping {
                node,
                world,
                inverse: world.inverse(),
                min: rect.min(),
                target: target.clone(),
            };
            self.maps.insert(target.surface.clone(), mapping);
        }
        self.nodes.insert(node, target);
    }

    /// Node `node` is overlay `name`: it takes the pointer while hit testing sees it.
    pub fn overlay(&mut self, node: NodeId, name: &str) {
        self.overlays.insert(node, name.to_owned());
    }

    /// Surface `surface` draws `owner`'s content: a plugin id, or `desk`.
    pub fn set_owner(&mut self, surface: &str, owner: &str) {
        self.owners.insert(surface.to_owned(), owner.to_owned());
    }

    pub fn owner(&self, surface: &str) -> Option<&str> {
        self.owners.get(surface).map(String::as_str)
    }

    /// A surface left: its mapping and owner go.
    pub fn forget(&mut self, surface: &str) {
        self.maps.remove(surface);
        self.owners.remove(surface);
        self.nodes.retain(|_, t| t.surface != surface);
    }

    /// Whether `surface` has a quad in the scene now.
    pub fn shown(&self, surface: &str) -> bool {
        self.nodes.values().any(|t| t.surface == surface)
    }

    /// What is topmost at screen point `point`.
    pub fn at(&self, scene: &Scene, point: Vec2) -> Option<Under> {
        let hit = hit_test(scene, point)?;
        if let Some(target) = self.nodes.get(&hit.node) {
            let at = target.origin + hit.local_point * target.per_unit;
            return Some(Under::Surface {
                surface: target.surface.clone(),
                at,
            });
        }
        if let Some(name) = self.overlays.get(&hit.node) {
            return Some(Under::Overlay {
                name: name.clone(),
                at: hit.local_point,
            });
        }
        Some(Under::Chrome(hit.node))
    }

    /// The surface under `point`, if a surface is topmost there.
    pub fn surface_at(&self, scene: &Scene, point: Vec2) -> Option<(String, Vec2)> {
        match self.at(scene, point)? {
            Under::Surface { surface, at } => Some((surface, at)),
            _ => None,
        }
    }

    /// Screen point `point` in `surface`'s logical pixels, wherever it is (in the plane of the
    /// surface's last quad).
    pub fn to_local(&self, surface: &str, point: Vec2) -> Option<Vec2> {
        let m = self.maps.get(surface)?;
        let local = m.inverse.transform_point3(Vec3::new(point.x, point.y, 0.0));
        Some(m.target.origin + (Vec2::new(local.x, local.y) - m.min) * m.target.per_unit)
    }

    /// `surface`'s logical point `local` on the screen, through the camera while its quad is in
    /// `scene`.
    pub fn to_screen(&self, scene: &Scene, surface: &str, local: Vec2) -> Option<Vec2> {
        let m = self.maps.get(surface)?;
        let unit = (local - m.target.origin) / m.target.per_unit.max(Vec2::splat(1e-6));
        if scene.node(m.node).is_some() {
            return scene.to_screen(m.node, unit);
        }
        let node = m.min + unit;
        let screen = m.world.transform_point3(Vec3::new(node.x, node.y, 0.0));
        Some(Vec2::new(screen.x, screen.y))
    }

    /// Surface pixels per screen pixel along x and y, for wheel deltas.
    pub fn per_screen_px(&self, surface: &str) -> Vec2 {
        self.maps
            .get(surface)
            .map_or(Vec2::ONE, |m| m.target.per_unit)
    }
}
