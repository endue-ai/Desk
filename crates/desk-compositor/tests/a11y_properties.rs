//! The desk's accessibility updates as properties (#57, proptest): whatever the surfaces send (roots
//! that move, children that are missing, repeated or cyclic, focus anywhere) and however the
//! chrome changes (windows that come and go, move, take the keys; surfaces asleep or gone), every
//! update the desk flushes is one AccessKit's consumer takes without panicking, and afterwards its
//! tree holds exactly the chrome's nodes and what each grafted surface's root reaches; a fresh
//! adapter fed the whole tree holds the same. Pure CPU, a fixed seed (`PROPTEST_RNG_SEED` picks
//! another, `PROPTEST_CASES` runs more), no regression files.

mod a11y_support;

use a11y_support::*;
use accesskit_consumer::NodeRef;
use desk_compositor::a11y::DeskA11y;
use proptest::prelude::*;
use proptest::test_runner::RngSeed;
use serde_json::json;

const SEED: u64 = 0x0057_acce_55ed;

fn config() -> ProptestConfig {
    let default = ProptestConfig::default();
    let rng_seed = if std::env::var_os("PROPTEST_RNG_SEED").is_some() {
        default.rng_seed
    } else {
        RngSeed::Fixed(SEED)
    };
    ProptestConfig {
        failure_persistence: None,
        rng_seed,
        ..default
    }
}

const SURFACES: [&str; 3] = ["s-1", "s-2", "s-3"];

#[derive(Clone, Debug)]
enum Step {
    /// A surface's update: a root maybe, nodes with children, a focus.
    Update {
        surface: usize,
        root: Option<u64>,
        nodes: Vec<(u64, u8, Vec<u64>)>,
        focus: u64,
    },
    /// Which of the three windows are open, where, and which surface has the keys.
    Chrome {
        open: [bool; 3],
        x: f32,
        focus: Option<usize>,
    },
    Unavailable(usize, bool),
    Forget(usize),
}

fn step() -> impl Strategy<Value = Step> {
    let node = (1u64..10, 0u8..4, prop::collection::vec(1u64..12, 0..4));
    prop_oneof![
        4 => (0usize..3, prop::option::of(1u64..6), prop::collection::vec(node, 0..8), 0u64..12)
            .prop_map(|(surface, root, nodes, focus)| Step::Update { surface, root, nodes, focus }),
        2 => (any::<[bool; 3]>(), 0f32..400.0, prop::option::of(0usize..3))
            .prop_map(|(open, x, focus)| Step::Chrome { open, x, focus }),
        1 => (0usize..3, any::<bool>()).prop_map(|(s, u)| Step::Unavailable(s, u)),
        1 => (0usize..3).prop_map(Step::Forget),
    ]
}

const ROLES: [&str; 4] = ["button", "group", "generic-container", "made-up"];

fn apply(a11y: &mut DeskA11y, step: &Step) {
    match step {
        Step::Update {
            surface,
            root,
            nodes,
            focus,
        } => {
            let nodes: Vec<_> = (nodes.iter())
                .map(|(id, role, children)| {
                    json!({ "id": id, "role": ROLES[*role as usize % 4], "name": format!("n{id}"),
                        "children": children })
                })
                .collect();
            let mut message = json!({ "type": "a11y.update", "surface": SURFACES[*surface],
                "nodes": nodes, "focus": focus });
            if let Some(root) = root {
                message["tree"] = json!({ "root": root });
            }
            a11y.update(update(message));
        }
        Step::Chrome { open, x, focus } => {
            let windows = (0..3)
                .filter(|i| open[*i])
                .map(|i| {
                    let at = (*x + 100.0 * i as f32, 40.0 + 30.0 * i as f32);
                    let s = SURFACES[i];
                    window(
                        s,
                        s,
                        at,
                        surface_at(s, f64::from(at.0), f64::from(at.1) + 40.0),
                    )
                })
                .collect();
            a11y.set_chrome(desk(windows, focus.map(|i| SURFACES[i])));
        }
        Step::Unavailable(s, u) => a11y.set_unavailable(SURFACES[*s], *u),
        Step::Forget(s) => a11y.forget(SURFACES[*s]),
    }
}

/// Every node the adapter's tree reaches from its root, through the grafts.
fn reached(node: &NodeRef) -> usize {
    1 + node.children().map(|c| reached(&c)).sum::<usize>()
}

/// What the desk's tree should hold: the chrome's nodes and each grafted surface's.
fn wanted(a11y: &DeskA11y) -> usize {
    let built = a11y.built();
    let grafted: usize = (built.grafts.keys())
        .filter_map(|s| a11y.tree(s))
        .map(|t| t.walk().len())
        .sum();
    built.nodes.len() + grafted
}

proptest! {
    #![proptest_config(config())]

    #[test]
    fn every_flushed_update_is_one_the_adapter_takes_and_its_tree_is_the_desks(
        steps in prop::collection::vec(step(), 1..24),
    ) {
        let mut a11y = DeskA11y::new();
        a11y.activate();
        a11y.set_chrome(desk(Vec::new(), None));
        let mut adapter = Adapter::default();
        for step in &steps {
            apply(&mut a11y, step);
            adapter.apply(a11y.flush());
            let tree = adapter.tree.as_ref().expect("the first flush makes the tree");
            prop_assert_eq!(reached(&tree.state().root()), wanted(&a11y), "after {:?}", step);
        }
        let mut fresh = Adapter::default();
        fresh.apply(a11y.full());
        prop_assert_eq!(fresh.seen(), adapter.seen());
    }
}
