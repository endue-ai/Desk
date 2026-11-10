//! Acceptance (#57): the desk is one accessibility tree. The compositor's chrome (the window list,
//! each window with its title bar, the cards with their buttons) and every surface's tree, grafted
//! where the surface is drawn, reach a platform adapter (AccessKit's consumer, which panics on an
//! update it cannot take) as one tree a screen reader walks: the window list, a title bar and a
//! plugin's content with bounds in the window's device pixels, the focus where the keys are, a
//! surface's change as that node alone, a window that goes and comes back, and a surface's tree
//! that lies about its children cut to what its root reaches. Pure CPU.

mod a11y_support;

use a11y_support::*;
use accesskit::{Action, ActionData, ActionRequest, NodeId, Role, TreeId};
use desk_compositor::a11y::{DeskA11y, PaneShows, Placed, Request, tree_of};

/// The subtree surface `surface` is grafted as.
fn subtree(a11y: &DeskA11y, surface: &str) -> TreeId {
    a11y.tree_id(surface).expect("a grafted surface")
}
use desk_surface::generated::{SurfaceA11yActionName, SurfaceWheelUnit};
use serde_json::json;

/// Two windows: Notes showing surface `s-7` at (100, 100) with the keys, Git asleep at (400, 160).
fn two_windows() -> (DeskA11y, Adapter) {
    let mut a11y = DeskA11y::new();
    a11y.activate();
    let w1 = window(
        "w1",
        "Notes",
        (100.0, 60.0),
        surface_at("s-7", 101.0, 100.0),
    );
    let w2 = window("w2", "Git", (400.0, 160.0), asleep(401.0, 200.0));
    a11y.set_chrome(desk(vec![w1, w2], Some("s-7")));
    a11y.update(page("Profiles", [16.0, 8.0, 32.0, 32.0]));
    a11y.update(notes("s-7"));
    let mut adapter = Adapter::default();
    adapter.apply(a11y.flush());
    (a11y, adapter)
}

#[test]
fn the_window_list_its_title_bars_and_a_plugins_content_are_one_tree() {
    let (_, adapter) = two_windows();
    let root = adapter.seen();
    assert_eq!(root.role, Role::Window);
    assert_eq!(root.label.as_deref(), Some("endue Desk"));
    assert_eq!(root.roles(), [Role::Group, Role::List]);
    assert_eq!(root.labels(), ["Desk", "Windows"]);
    // The page's tree is the desk's system layer.
    let desk = &root.children[0];
    assert_eq!(desk.children[0].role, Role::RootWebArea);
    assert_eq!(desk.children[0].labels(), ["Profiles"]);
    let windows = &root.children[1];
    assert_eq!(windows.labels(), ["Notes", "Git"]);
    let notes = &windows.children[0];
    assert_eq!(notes.role, Role::Window);
    assert_eq!(notes.roles(), [Role::TitleBar, Role::RootWebArea]);
    assert_eq!(notes.children[0].label.as_deref(), Some("Notes"));
    let content = &notes.children[1];
    assert_eq!(content.label.as_deref(), Some("Notes"));
    assert_eq!(content.labels(), ["Shopping", "New item", "Milk", "Add"]);
    let git = &windows.children[1];
    assert_eq!(git.roles(), [Role::TitleBar, Role::Group]);
    assert_eq!(git.children[1].label.as_deref(), Some("Git"));
    assert_eq!(git.children[1].labels(), ["Reload"]);
}

#[test]
fn bounds_are_the_windows_device_pixels_through_where_each_surface_is_drawn() {
    let (a11y, adapter) = two_windows();
    let (_, tree, add) = adapter
        .find(Role::Button, "Add")
        .expect("the plugin's button");
    assert_eq!(tree, subtree(&a11y, "s-7"));
    // (700, 60) in the surface, drawn at (101, 100) in the window, at scale 2.
    assert_eq!(add.bounds, Some([1602.0, 320.0, 168.0, 56.0]));
    let (_, _, bar) = adapter
        .find(Role::TitleBar, "Notes")
        .expect("the title bar");
    assert_eq!(bar.bounds, Some([200.0, 120.0, 1600.0, 80.0]));
    let (_, tree, reload) = adapter
        .find(Role::Button, "Reload")
        .expect("the card's button");
    assert_eq!(tree, TreeId::ROOT);
    assert_eq!(reload.bounds, Some([1522.0, 1060.0, 160.0, 64.0]));
}

#[test]
fn the_focus_is_the_focused_node_of_the_surface_with_the_keys() {
    let (mut a11y, mut adapter) = two_windows();
    let focus = adapter.focus().expect("a focus");
    assert_eq!(focus.label.as_deref(), Some("New item"), "the field in s-7");
    // The keys go to the page: its own focus.
    let mut chrome = a11y.chrome().clone();
    chrome.focus = Some("desk".into());
    a11y.set_chrome(chrome.clone());
    adapter.apply(a11y.flush());
    assert_eq!(
        adapter.focus().and_then(|f| f.label).as_deref(),
        Some("endue Desk")
    );
    chrome.focus = None;
    a11y.set_chrome(chrome);
    adapter.apply(a11y.flush());
    assert_eq!(adapter.focus().map(|f| f.role), Some(Role::Window));
}

#[test]
fn a_surfaces_change_goes_out_as_that_node_alone() {
    let (mut a11y, mut adapter) = two_windows();
    assert!(a11y.flush().is_empty(), "nothing changed, nothing goes");
    a11y.update(update(json!({
        "type": "a11y.update", "surface": "s-7",
        "nodes": [{ "id": 3, "role": "text-input", "name": "New item", "value": "Buy milk",
            "actions": ["focus", "set-value"] }],
        "focus": 3
    })));
    let updates = a11y.flush();
    assert_eq!(updates.len(), 1, "{updates:?}");
    assert_eq!(updates[0].tree_id, subtree(&a11y, "s-7"));
    assert_eq!(updates[0].nodes.len(), 1);
    assert!(updates[0].tree.is_none());
    adapter.apply(updates);
    let (_, _, field) = adapter
        .find(Role::TextInput, "New item")
        .expect("the field");
    assert_eq!(field.value.as_deref(), Some("Buy milk"));
}

#[test]
fn a_window_that_goes_takes_its_tree_and_one_that_comes_back_brings_it_whole() {
    let (mut a11y, mut adapter) = two_windows();
    let all = a11y.chrome().clone();
    let mut fewer = all.clone();
    fewer.windows.remove(0);
    fewer.focus = None;
    a11y.set_chrome(fewer);
    adapter.apply(a11y.flush());
    assert!(adapter.find(Role::Button, "Add").is_none());
    assert_eq!(adapter.seen().children[1].labels(), ["Git"]);
    a11y.set_chrome(all);
    let updates = a11y.flush();
    let s7 = subtree(&a11y, "s-7");
    let pushed = updates.iter().find(|u| u.tree_id == s7);
    assert!(pushed.is_some_and(|u| u.tree.is_some() && u.nodes.len() == 5));
    adapter.apply(updates);
    assert!(adapter.find(Role::Button, "Add").is_some());
    assert_eq!(
        adapter.focus().and_then(|f| f.label).as_deref(),
        Some("New item")
    );
}

#[test]
fn a_moved_window_moves_its_surfaces_bounds() {
    let (mut a11y, mut adapter) = two_windows();
    let mut chrome = a11y.chrome().clone();
    chrome.windows[0] = window(
        "w1",
        "Notes",
        (200.0, 60.0),
        surface_at("s-7", 201.0, 100.0),
    );
    a11y.set_chrome(chrome);
    let updates = a11y.flush();
    assert!(
        updates.iter().all(|u| u.tree_id == TreeId::ROOT),
        "only the graft moves"
    );
    adapter.apply(updates);
    let (_, _, add) = adapter.find(Role::Button, "Add").expect("the button");
    assert_eq!(add.bounds, Some([1802.0, 320.0, 168.0, 56.0]));
}

#[test]
fn a_tree_that_lies_about_its_children_reaches_the_adapter_cut_to_what_its_root_reaches() {
    let mut a11y = DeskA11y::new();
    a11y.activate();
    a11y.set_chrome(desk(
        vec![window(
            "w1",
            "Odd",
            (0.0, 40.0),
            surface_at("s-9", 1.0, 80.0),
        )],
        None,
    ));
    // A missing child, a child twice, a cycle back to the root, a node nobody reaches, and a focus
    // on a node that is not there.
    a11y.update(update(json!({
        "type": "a11y.update", "surface": "s-9", "tree": { "root": 1 },
        "nodes": [
            { "id": 1, "role": "root-web-area", "name": "Odd", "children": [2, 3, 42, 2] },
            { "id": 2, "role": "button", "name": "One", "children": [1] },
            { "id": 3, "role": "group", "name": "Two", "children": [2, 4] },
            { "id": 4, "role": "made-up", "name": "Three" },
            { "id": 5, "role": "button", "name": "Nobody's" }
        ],
        "focus": 77
    })));
    let mut adapter = Adapter::default();
    adapter.apply(a11y.flush());
    let (_, _, odd) = adapter
        .find(Role::RootWebArea, "Odd")
        .expect("the surface's root");
    assert_eq!(odd.labels(), ["One", "Two"]);
    assert_eq!(odd.children[0].children.len(), 0, "no cycle");
    assert_eq!(odd.children[1].labels(), ["Three"]);
    assert_eq!(odd.children[1].children[0].role, Role::Unknown);
    assert!(adapter.find(Role::Button, "Nobody's").is_none());
    assert_eq!(
        a11y.tree("s-9").map(|t| t.len()),
        Some(4),
        "the unreachable node is gone"
    );
    // The next update moves node 4 under node 2: both change, and the adapter takes it.
    a11y.update(update(json!({
        "type": "a11y.update", "surface": "s-9",
        "nodes": [
            { "id": 2, "role": "button", "name": "One", "children": [4] },
            { "id": 3, "role": "group", "name": "Two" }
        ],
        "focus": 4
    })));
    adapter.apply(a11y.flush());
    let (_, _, one) = adapter.find(Role::Button, "One").expect("the button");
    assert_eq!(one.labels(), ["Three"]);
}

#[test]
fn nothing_goes_out_until_an_assistive_technology_is_active_and_all_of_it_when_one_asks() {
    let mut a11y = DeskA11y::new();
    a11y.set_chrome(desk(
        vec![window(
            "w1",
            "Notes",
            (0.0, 40.0),
            surface_at("s-7", 1.0, 80.0),
        )],
        None,
    ));
    a11y.update(notes("s-7"));
    assert!(a11y.flush().is_empty(), "inactive: no updates");
    assert!(a11y.tree("s-7").is_none(), "inactive: no trees kept");
    a11y.activate();
    a11y.update(notes("s-7"));
    let mut adapter = Adapter::default();
    adapter.apply(a11y.flush());
    // The adapter asks again for the whole tree: a fresh adapter takes it.
    let mut again = Adapter::default();
    again.apply(a11y.full());
    assert_eq!(again.seen(), adapter.seen());
    a11y.deactivate();
    assert!(a11y.flush().is_empty() && a11y.tree("s-7").is_none());
}

fn request(action: Action, tree: TreeId, node: NodeId, data: Option<ActionData>) -> ActionRequest {
    ActionRequest {
        action,
        target_tree: tree,
        target_node: node,
        data,
    }
}

#[test]
fn a_press_the_focus_a_value_and_a_scroll_reach_the_surface_and_the_chrome_presses_where_drawn() {
    let (a11y, adapter) = two_windows();
    let (add, tree, _) = adapter.find(Role::Button, "Add").expect("the button");
    let asked = a11y.request(&request(Action::Click, tree, add, None));
    assert_eq!(
        asked[0],
        Request::Focus {
            surface: "s-7".into()
        }
    );
    let Request::Surface(click) = &asked[1] else {
        panic!("{asked:?}")
    };
    assert_eq!(
        (click.node, click.action),
        (5, SurfaceA11yActionName::Click)
    );
    let (field, _, _) = adapter
        .find(Role::TextInput, "New item")
        .expect("the field");
    let value = Some(ActionData::Value("Buy milk".into()));
    let asked = a11y.request(&request(Action::SetValue, tree, field, value));
    let Some(Request::Surface(set)) = asked.last() else {
        panic!("{asked:?}")
    };
    assert_eq!(set.action, SurfaceA11yActionName::SetValue);
    assert_eq!(set.value.as_deref(), Some("Buy milk"));
    let asked = a11y.request(&request(Action::ScrollDown, tree, add, None));
    assert_eq!(
        asked,
        [Request::Wheel {
            surface: "s-7".into(),
            at: (742.0, 74.0),
            delta: (0.0, 3.0),
            unit: SurfaceWheelUnit::Line
        }]
    );
    let (reload, root, _) = adapter
        .find(Role::Button, "Reload")
        .expect("the card's button");
    let asked = a11y.request(&request(Action::Click, root, reload, None));
    assert_eq!(asked, [Request::Press { at: (801.0, 546.0) }]);
    let (bar, _, _) = adapter
        .find(Role::TitleBar, "Git")
        .expect("Git's title bar");
    let asked = a11y.request(&request(Action::Click, root, bar, None));
    assert_eq!(asked, [Request::Press { at: (800.0, 180.0) }]);
    let nobody = a11y.request(&request(Action::Click, tree, NodeId(999), None));
    assert!(nobody.is_empty(), "a node the surface does not have");
    let other = a11y.request(&request(Action::Click, tree_of("s-1", 1), add, None));
    assert!(other.is_empty(), "a tree the desk does not have");
}

#[test]
fn an_asleep_surfaces_last_tree_stays_marked_and_takes_no_action() {
    let (mut a11y, mut adapter) = two_windows();
    let mut chrome = a11y.chrome().clone();
    let card = asleep(101.0, 100.0);
    let PaneShows::Card(card) = card else {
        unreachable!()
    };
    chrome.windows[0].panes[0].shows = PaneShows::Over(Placed::at("s-7", 101.0, 100.0), card);
    a11y.set_chrome(chrome);
    a11y.set_unavailable("s-7", true);
    adapter.apply(a11y.flush());
    let notes = &adapter.seen().children[1].children[0];
    assert_eq!(
        notes.roles(),
        [Role::TitleBar, Role::RootWebArea, Role::Group]
    );
    let tree = adapter.tree.as_ref().expect("a tree");
    let root = tree
        .state()
        .node_by_tree_local_id(NodeId(1), subtree(&a11y, "s-7"));
    assert!(root.is_some_and(|n| n.is_disabled()), "marked unavailable");
    let (add, t, _) = adapter.find(Role::Button, "Add").expect("the button");
    assert!(
        a11y.request(&request(Action::Click, t, add, None))
            .is_empty()
    );
}
