//! The retained scene: a tree of nodes under one root group, a wallpaper and a camera. Every
//! mutation records the screen region it touched in the damage log ([`Scene::damage_since`]).

use crate::camera::{Camera, Projection};
use crate::damage::DamageLog;
use crate::node::{GroupNode, Node, NodeId, NodeKind};
use crate::types::{Color, Rect, TextureId, union};
use glam::{Mat4, Vec2};
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, Ordering};

/// Hands every scene an identity, so a compositor drawing several tells them apart.
static NEXT_SCENE: AtomicU64 = AtomicU64::new(1);

/// What the desk shows under every node, filling the viewport.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wallpaper {
    Solid(Color),
    /// A vertical gradient.
    Gradient {
        top: Color,
        bottom: Color,
    },
    /// A registered texture, scaled to cover the viewport (cropped, never stretched).
    Texture(TextureId),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SceneError {
    NoSuchNode(NodeId),
    /// Children go under groups only, and a node with children stays a group.
    NotAGroup(NodeId),
    /// The root cannot be removed or moved.
    Root,
}

impl std::fmt::Display for SceneError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SceneError::NoSuchNode(id) => write!(f, "no node {}", id.0),
            SceneError::NotAGroup(id) => write!(f, "node {} is not a group", id.0),
            SceneError::Root => write!(f, "the root group cannot be removed or moved"),
        }
    }
}

impl std::error::Error for SceneError {}

#[derive(Debug)]
pub(crate) struct Entry {
    pub node: Node,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
}

#[derive(Debug)]
pub struct Scene {
    id: u64,
    entries: HashMap<NodeId, Entry>,
    root: NodeId,
    viewport: (u32, u32),
    projection: Projection,
    wallpaper: Wallpaper,
    next_id: u64,
    damage: DamageLog,
    animating: BTreeSet<NodeId>,
}

impl Scene {
    /// An empty scene for a `width` x `height` pixel target: a root group, a black wallpaper and an
    /// orthographic camera.
    pub fn new(width: u32, height: u32) -> Scene {
        let root = NodeId(0);
        let entry = Entry {
            node: GroupNode::default().into(),
            parent: None,
            children: Vec::new(),
        };
        let viewport = (width.max(1), height.max(1));
        Scene {
            id: NEXT_SCENE.fetch_add(1, Ordering::Relaxed),
            entries: HashMap::from([(root, entry)]),
            root,
            viewport,
            projection: Projection::default(),
            wallpaper: Wallpaper::Solid(Color::BLACK),
            next_id: 1,
            damage: DamageLog::new(Camera::new(Projection::default(), viewport).full()),
            animating: BTreeSet::new(),
        }
    }

    pub fn root(&self) -> NodeId {
        self.root
    }

    pub fn viewport(&self) -> (u32, u32) {
        self.viewport
    }

    pub fn projection(&self) -> Projection {
        self.projection
    }

    pub fn wallpaper(&self) -> Wallpaper {
        self.wallpaper
    }

    /// Follow the target's new size (everything is damaged).
    pub fn resize(&mut self, width: u32, height: u32) {
        let viewport = (width.max(1), height.max(1));
        if viewport != self.viewport {
            self.viewport = viewport;
            self.damage_all();
        }
    }

    pub fn set_projection(&mut self, projection: Projection) {
        if projection != self.projection {
            self.projection = projection;
            self.damage_all();
        }
    }

    pub fn set_wallpaper(&mut self, wallpaper: Wallpaper) {
        if wallpaper != self.wallpaper {
            self.wallpaper = wallpaper;
            self.damage_all();
        }
    }

    /// Add `node` as the topmost child of the group `parent`.
    pub fn insert(&mut self, parent: NodeId, node: impl Into<Node>) -> Result<NodeId, SceneError> {
        let parent_entry = self.entry(parent)?;
        if !parent_entry.node.is_group() {
            return Err(SceneError::NotAGroup(parent));
        }
        let id = NodeId(self.next_id);
        self.next_id += 1;
        let entry = Entry {
            node: node.into(),
            parent: Some(parent),
            children: Vec::new(),
        };
        self.entries.insert(id, entry);
        if let Some(p) = self.entries.get_mut(&parent) {
            p.children.push(id);
        }
        self.damage_node(id);
        Ok(id)
    }

    /// Replace a node's data (a group keeps its children). Setting the same data changes nothing.
    pub fn set(&mut self, id: NodeId, node: impl Into<Node>) -> Result<(), SceneError> {
        let node = node.into();
        let entry = self.entry(id)?;
        if entry.node == node {
            return Ok(());
        }
        if !node.is_group() && (id == self.root || !entry.children.is_empty()) {
            return Err(SceneError::NotAGroup(id));
        }
        let before = self.screen_bounds(id);
        if let Some(e) = self.entries.get_mut(&id) {
            e.node = node;
        }
        let after = self.screen_bounds(id);
        self.damage.push(union(before, after));
        Ok(())
    }

    /// Remove a node and its subtree, returning the node's data.
    pub fn remove(&mut self, id: NodeId) -> Result<Node, SceneError> {
        if id == self.root {
            return Err(SceneError::Root);
        }
        self.entry(id)?;
        self.damage_node(id);
        let parent = self.entries[&id].parent;
        if let Some(p) = parent.and_then(|p| self.entries.get_mut(&p)) {
            p.children.retain(|c| *c != id);
        }
        let mut stack = vec![id];
        let mut node = None;
        while let Some(next) = stack.pop() {
            if let Some(entry) = self.entries.remove(&next) {
                self.animating.remove(&next);
                stack.extend(entry.children);
                node.get_or_insert(entry.node);
            }
        }
        node.ok_or(SceneError::NoSuchNode(id))
    }

    /// Move a node to position `index` among its siblings (clamped; the last is drawn on top).
    pub fn reorder(&mut self, id: NodeId, index: usize) -> Result<(), SceneError> {
        let parent = self.entry(id)?.parent.ok_or(SceneError::Root)?;
        let siblings = &mut self
            .entries
            .get_mut(&parent)
            .ok_or(SceneError::NoSuchNode(parent))?
            .children;
        let from = siblings.iter().position(|c| *c == id);
        let to = index.min(siblings.len() - 1);
        if let Some(from) = from.filter(|f| *f != to) {
            siblings.remove(from);
            siblings.insert(to, id);
            self.damage_node(id);
        }
        Ok(())
    }

    /// Redraw a node every frame while `on` (a live surface, an effect that moves by itself); the
    /// compositor reports `animating` so the caller keeps scheduling frames.
    pub fn set_animating(&mut self, id: NodeId, on: bool) -> Result<(), SceneError> {
        self.entry(id)?;
        if on {
            self.animating.insert(id);
        } else {
            self.animating.remove(&id);
        }
        Ok(())
    }

    pub fn is_animating(&self) -> bool {
        !self.animating.is_empty()
    }

    pub fn node(&self, id: NodeId) -> Option<&Node> {
        self.entries.get(&id).map(|e| &e.node)
    }

    /// A group's children in draw order (bottom first); empty for leaves and unknown ids.
    pub fn children(&self, id: NodeId) -> &[NodeId] {
        self.entries.get(&id).map_or(&[], |e| &e.children)
    }

    pub fn parent(&self, id: NodeId) -> Option<NodeId> {
        self.entries.get(&id).and_then(|e| e.parent)
    }

    /// How many nodes the scene holds, the root included.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.len() == 1
    }

    /// The scene's change counter; it moves on every change that touches the screen.
    pub fn revision(&self) -> u64 {
        self.damage.revision()
    }

    /// The screen region changed after `revision`, `None` when nothing visible changed.
    pub fn damage_since(&self, revision: u64) -> Option<Rect> {
        self.damage.since(revision, self.camera().full())
    }

    /// The matrix from a node's own units to the scene's: for a group its children's space, for a
    /// leaf its parent's.
    pub fn world_transform(&self, id: NodeId) -> Option<Mat4> {
        let entry = self.entries.get(&id)?;
        let own = match &entry.node.kind {
            NodeKind::Group(g) => g.transform,
            _ => Mat4::IDENTITY,
        };
        let parent = match entry.parent {
            Some(p) => self.world_transform(p)?,
            None => Mat4::IDENTITY,
        };
        Some(parent * own)
    }

    /// The screen pixel a point in a node's own units lands on: for a leaf relative to its
    /// rectangle's top-left (as [`crate::Hit::local_point`] gives it, so an IME caret can be placed),
    /// for a group in its children's units. `None` behind the eye.
    pub fn to_screen(&self, id: NodeId, local: Vec2) -> Option<Vec2> {
        let origin = self.node(id)?.rect().map_or(Vec2::ZERO, |r| r.min());
        self.camera()
            .project(&self.world_transform(id)?, local + origin)
    }

    /// The screen pixels a node and its subtree paint (shadows and antialiasing included, the
    /// ancestors' clips applied); `None` when nothing of it is on screen.
    pub fn screen_bounds(&self, id: NodeId) -> Option<Rect> {
        let camera = self.camera();
        let parent = self.parent(id).and_then(|p| self.world_transform(p));
        let mut bounds = self.subtree_bounds(id, &parent.unwrap_or(Mat4::IDENTITY), &camera)?;
        let mut ancestor = self.parent(id);
        while let Some(a) = ancestor {
            if let Some(NodeKind::Group(GroupNode {
                clip: Some(clip), ..
            })) = self.node(a).map(|n| n.kind)
            {
                let clip = camera.screen_bounds(&self.world_transform(a)?, &clip)?;
                bounds = bounds.intersect(&clip)?;
            }
            ancestor = self.parent(a);
        }
        Some(bounds)
    }

    pub(crate) fn id(&self) -> u64 {
        self.id
    }

    pub(crate) fn camera(&self) -> Camera {
        Camera::new(self.projection, self.viewport)
    }

    pub(crate) fn entry_of(&self, id: NodeId) -> Option<&Entry> {
        self.entries.get(&id)
    }

    pub(crate) fn nodes(&self) -> impl Iterator<Item = (NodeId, &Node)> + '_ {
        self.entries.iter().map(|(id, e)| (*id, &e.node))
    }

    pub(crate) fn animating(&self) -> impl Iterator<Item = NodeId> + '_ {
        self.animating.iter().copied()
    }

    fn subtree_bounds(&self, id: NodeId, parent_world: &Mat4, camera: &Camera) -> Option<Rect> {
        let entry = self.entries.get(&id)?;
        match &entry.node.kind {
            NodeKind::Group(group) => {
                let world = *parent_world * group.transform;
                let inside = entry
                    .children
                    .iter()
                    .filter_map(|c| self.subtree_bounds(*c, &world, camera))
                    .reduce(|a, b| a.union(&b))?;
                match group.clip {
                    Some(clip) => inside.intersect(&camera.screen_bounds(&world, &clip)?),
                    None => Some(inside),
                }
            }
            _ => {
                let rect = entry.node.paint_bounds()?;
                let screen = camera.screen_bounds(parent_world, &rect)?;
                screen.inflate(1.0).intersect(&camera.full())
            }
        }
    }

    fn entry(&self, id: NodeId) -> Result<&Entry, SceneError> {
        self.entries.get(&id).ok_or(SceneError::NoSuchNode(id))
    }

    fn damage_node(&mut self, id: NodeId) {
        let bounds = self.screen_bounds(id);
        self.damage.push(bounds);
    }

    fn damage_all(&mut self) {
        let full = self.camera().full();
        self.damage.push(Some(full));
    }
}

#[cfg(test)]
#[path = "scene_tests.rs"]
mod tests;
