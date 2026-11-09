//! Hit testing: which node is under a screen point, top-down, and where in that node.
//!
//! The camera's ray through the point is carried into each group's space with the inverse of the
//! group's world transform and met with that space's z = 0 plane, so tilted and perspective nodes
//! hit where they are drawn. Clips and `hit: false` are honoured; shadows and rounded corners are
//! not (a node hits on its whole rectangle).

use crate::camera::Ray;
use crate::node::{NodeId, NodeKind};
use crate::scene::Scene;
use glam::{Mat4, Vec2};

/// The node under a point and the point in that node's own units, relative to its rectangle's
/// top-left corner (a surface's content coordinates before any scale the texture has).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    pub node: NodeId,
    pub local_point: Vec2,
}

/// The topmost hittable leaf under screen pixel `point`, if any. The wallpaper is never hit.
pub fn hit_test(scene: &Scene, point: Vec2) -> Option<Hit> {
    let ray = scene.camera().ray(point);
    visit(scene, scene.root(), &Mat4::IDENTITY, &ray)
}

fn visit(scene: &Scene, id: NodeId, parent_world: &Mat4, ray: &Ray) -> Option<Hit> {
    let entry = scene.entry_of(id)?;
    if !entry.node.hit {
        return None;
    }
    match &entry.node.kind {
        NodeKind::Group(group) => {
            let world = *parent_world * group.transform;
            if let Some(clip) = group.clip {
                let local = local_point(&world, ray)?;
                if !clip.contains(local) {
                    return None;
                }
            }
            entry
                .children
                .iter()
                .rev()
                .find_map(|child| visit(scene, *child, &world, ray))
        }
        NodeKind::Rect(_) | NodeKind::Surface(_) => {
            let rect = entry.node.rect()?;
            let local = local_point(parent_world, ray)?;
            rect.contains(local).then(|| Hit {
                node: id,
                local_point: local - rect.min(),
            })
        }
    }
}

/// Where `ray` (in scene space) meets the z = 0 plane of the space `world` maps to the scene.
fn local_point(world: &Mat4, ray: &Ray) -> Option<Vec2> {
    if world.determinant().abs() < 1e-12 {
        return None;
    }
    ray.transformed(&world.inverse()).hit_plane()
}
