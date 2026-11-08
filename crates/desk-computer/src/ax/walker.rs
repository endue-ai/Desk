//! The breadth-first walk every `Computer` uses for `tree` and `find`.

use std::collections::VecDeque;

use super::{Budget, Element, Node, Query, Tree};

/// Where a walk reads elements: the OS's AXUIElements, or a scripted tree. Reads never fail: an
/// element that cannot answer (it went away, its app is busy) has no children and empty
/// attributes. The walker fills in each element's `path`.
pub trait Source {
    type Handle;

    /// The element's children, in `AXChildren` order.
    fn children(&mut self, of: &Self::Handle) -> Vec<Self::Handle>;

    /// How many children it has, without reading them; asked at the depth limit.
    fn child_count(&mut self, of: &Self::Handle) -> u32 {
        self.children(of).len() as u32
    }

    /// Its attributes.
    fn element(&mut self, of: &Self::Handle) -> Element;
}

struct Visited {
    element: Element,
    parent: Option<usize>,
    depth: u32,
    child_count: Option<u32>,
}

/// Visit `root` (at `path`) and its descendants breadth first within `budget` (clamped), until
/// `keep_going` answers false for an element it was shown. Returns the visited elements in visit
/// order, parents before children, and whether the budget left any children out.
fn visit<S: Source>(
    source: &mut S,
    root: S::Handle,
    path: Vec<u32>,
    budget: Budget,
    mut keep_going: impl FnMut(&Element) -> bool,
) -> (Vec<Visited>, bool) {
    let budget = budget.clamped();
    let mut element = source.element(&root);
    element.path = path;
    let go_on = keep_going(&element);
    let mut visited = vec![Visited {
        element,
        parent: None,
        depth: 0,
        child_count: None,
    }];
    let mut queue = VecDeque::from([(root, 0usize)]);
    let mut truncated = false;
    if !go_on {
        return (visited, truncated);
    }
    'walk: while let Some((handle, index)) = queue.pop_front() {
        let depth = visited[index].depth;
        if depth >= budget.depth {
            let count = source.child_count(&handle);
            visited[index].child_count = Some(count);
            truncated |= count > 0;
            continue;
        }
        let children = source.children(&handle);
        visited[index].child_count = Some(children.len() as u32);
        for (position, child) in children.into_iter().enumerate() {
            if visited.len() as u32 >= budget.nodes {
                truncated = true;
                break 'walk;
            }
            let mut element = source.element(&child);
            element.path = visited[index].element.path.clone();
            element.path.push(position as u32);
            let go_on = keep_going(&element);
            visited.push(Visited {
                element,
                parent: Some(index),
                depth: depth + 1,
                child_count: None,
            });
            if !go_on {
                break 'walk;
            }
            queue.push_back((child, visited.len() - 1));
        }
    }
    // Elements still queued were never asked for their children.
    truncated |= !queue.is_empty();
    (visited, truncated)
}

/// The tree below `root` (at `path`) within `budget`, as nested nodes.
pub fn walk<S: Source>(source: &mut S, root: S::Handle, path: Vec<u32>, budget: Budget) -> Node {
    let (visited, _) = visit(source, root, path, budget, |_| true);
    nest(visited)
}

/// The tree of `pid` below `root` (at `path`) within `budget`.
pub fn tree<S: Source>(
    source: &mut S,
    pid: i32,
    root: S::Handle,
    path: Vec<u32>,
    budget: Budget,
) -> Tree {
    let (visited, truncated) = visit(source, root, path, budget, |_| true);
    let nodes = visited.len() as u32;
    Tree {
        pid,
        root: nest(visited),
        nodes,
        truncated,
    }
}

/// The elements below `root` (at `path`, itself included) that `query` matches, nearest the root
/// first, at most `query.limit` of them, visiting no more than `budget` allows.
pub fn find<S: Source>(
    source: &mut S,
    root: S::Handle,
    path: Vec<u32>,
    query: &Query,
    budget: Budget,
) -> Vec<Element> {
    let limit = query.limit as usize;
    let mut found = Vec::new();
    if limit == 0 {
        return found;
    }
    visit(source, root, path, budget, |element| {
        if query.matches(element) {
            found.push(element.clone());
        }
        found.len() < limit
    });
    found
}

/// Nest visited elements under their parents. Children always come after their parent, so taking
/// them from the back fills every node before it moves into its own parent.
fn nest(visited: Vec<Visited>) -> Node {
    let mut parents = Vec::with_capacity(visited.len());
    let mut nodes: Vec<Option<Node>> = visited
        .into_iter()
        .map(|v| {
            parents.push(v.parent);
            Some(Node {
                element: v.element,
                children: Vec::new(),
                child_count: v.child_count,
            })
        })
        .collect();
    for index in (1..nodes.len()).rev() {
        let Some(mut node) = nodes[index].take() else {
            continue;
        };
        node.children.reverse();
        if let Some(parent) = parents[index].and_then(|p| nodes[p].as_mut()) {
            parent.children.push(node);
        }
    }
    let mut root = nodes.first_mut().and_then(Option::take).unwrap_or_default();
    root.children.reverse();
    root
}
