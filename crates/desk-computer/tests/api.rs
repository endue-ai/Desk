//! The pure parts, on any OS: the AX walk's budget, the element finder, Unicode chunking for
//! CGEvent, chords and key codes, and capture sizes.

use desk_computer::ax::{self, Budget, Element, MAX_DEPTH, MAX_NODES, Node, Query, Source};
use desk_computer::input::{Event, MAX_UNITS, chunks, plan_text};
use desk_computer::keys::{Chord, Key, Modifiers, mac_code};
use desk_computer::screen::{Capture, Target};
use desk_computer::{ErrorCode, Rect};

/// A full tree `fanout` wide and `depth` deep below the root, generated as it is read, counting
/// how often it was read.
struct Grid {
    fanout: u32,
    depth: u32,
    reads: u32,
}

impl Source for Grid {
    /// The path of the node.
    type Handle = Vec<u32>;

    fn children(&mut self, of: &Vec<u32>) -> Vec<Vec<u32>> {
        self.reads += 1;
        if of.len() as u32 >= self.depth {
            return Vec::new();
        }
        (0..self.fanout)
            .map(|i| of.iter().copied().chain([i]).collect())
            .collect()
    }

    fn element(&mut self, of: &Vec<u32>) -> Element {
        let name: Vec<String> = of.iter().map(u32::to_string).collect();
        let role = if of.is_empty() {
            "AXApplication"
        } else {
            "AXGroup"
        };
        Element::new(role).title(format!("node {}", name.join(".")))
    }
}

fn grid() -> Grid {
    Grid {
        fanout: 5,
        depth: 10,
        reads: 0,
    }
}

fn depth_of(node: &Node) -> usize {
    1 + node.children.iter().map(depth_of).max().unwrap_or(0)
}

#[test]
fn the_ax_tree_budget_is_enforced_for_depth() {
    let mut source = grid();
    let tree = ax::tree(
        &mut source,
        7,
        Vec::new(),
        Vec::new(),
        Budget::new(2, 1_000),
    );
    assert_eq!(tree.nodes, 1 + 5 + 25);
    assert_eq!(depth_of(&tree.root), 3, "the root and two levels below it");
    assert!(tree.truncated);
    let leaf = &tree.root.children[4].children[3];
    assert_eq!(leaf.element.path, vec![4, 3]);
    assert_eq!(leaf.element.title.as_deref(), Some("node 4.3"));
    assert!(leaf.children.is_empty());
    assert_eq!(
        leaf.child_count,
        Some(5),
        "the depth limit says what it left out"
    );
    // Depth 0 is the root alone.
    let root = ax::tree(
        &mut grid(),
        7,
        Vec::new(),
        Vec::new(),
        Budget::new(0, 1_000),
    );
    assert_eq!((root.nodes, root.root.child_count), (1, Some(5)));
}

#[test]
fn the_ax_tree_budget_is_enforced_for_nodes() {
    let mut source = grid();
    let tree = ax::tree(&mut source, 7, Vec::new(), Vec::new(), Budget::new(10, 8));
    assert_eq!(tree.nodes, 8);
    assert!(tree.truncated);
    // Breadth first: the root, its five children, then the first two grandchildren.
    let all = tree.root.flatten();
    assert_eq!(all.len(), 8);
    let paths: Vec<&[u32]> = all.iter().map(|n| n.element.path.as_slice()).collect();
    assert_eq!(
        paths,
        vec![&[][..], &[0], &[1], &[2], &[3], &[4], &[0, 0], &[0, 1]]
    );
    assert_eq!(tree.root.children[0].child_count, Some(5));
    assert_eq!(tree.root.children[1].child_count, None, "never asked");
    assert!(
        source.reads <= 2,
        "the walk stopped reading: {} reads",
        source.reads
    );

    // Budgets are clamped: at least the root, at most the hard caps.
    assert_eq!(Budget::new(1_000, 0).clamped(), Budget::new(MAX_DEPTH, 1));
    assert_eq!(Budget::new(3, u32::MAX).clamped().nodes, MAX_NODES);
    let huge = ax::tree(
        &mut grid(),
        7,
        Vec::new(),
        Vec::new(),
        Budget::new(u32::MAX, u32::MAX),
    );
    assert_eq!(huge.nodes, MAX_NODES);
    let one = ax::tree(&mut grid(), 7, Vec::new(), Vec::new(), Budget::new(5, 0));
    assert_eq!((one.nodes, one.truncated), (1, true));
}

fn window() -> Node {
    let button = |title: &str| Node::new(Element::new("AXButton").title(title));
    let toolbar = Node::new(Element::new("AXToolbar")).with(vec![
        Node::new(Element::new("AXButton").description("Share")),
        button("Save As…"),
    ]);
    Node::new(Element::new("AXWindow").title("Report")).with(vec![
        Node::new(Element::new("AXButton").subrole("AXCloseButton")),
        toolbar,
        Node::new(Element::new("AXStaticText").value("저장되지 않음")),
        button("Save"),
        Node::new(Element::new("AXTextField").title("save path")),
    ])
}

struct Script;

impl<'a> Source for &'a Script {
    type Handle = &'a Node;
    fn children(&mut self, of: &&'a Node) -> Vec<&'a Node> {
        of.children.iter().collect()
    }
    fn element(&mut self, of: &&'a Node) -> Element {
        of.element.clone()
    }
}

fn find(root: &Node, query: &Query) -> Vec<(Vec<u32>, String)> {
    ax::find(&mut &Script, root, vec![0], query, Budget::default())
        .into_iter()
        .map(|e| (e.path.clone(), e.label().unwrap_or(&e.role).to_owned()))
        .collect()
}

#[test]
fn the_element_finder_matches_by_role_and_title() {
    let root = window();
    let at = |path: &[u32], label: &str| (path.to_vec(), label.to_owned());
    // Role with or without AX, in any case, and subroles; nearest the root first.
    assert_eq!(
        find(&root, &Query::any().role("button")),
        vec![
            at(&[0, 0], "AXButton"),
            at(&[0, 3], "Save"),
            at(&[0, 1, 0], "Share"),
            at(&[0, 1, 1], "Save As…"),
        ]
    );
    assert_eq!(find(&root, &Query::any().role("AXBUTTON")).len(), 4);
    assert_eq!(
        find(&root, &Query::any().role("closebutton")),
        vec![at(&[0, 0], "AXButton")]
    );
    // Title: anywhere and in any case, then exactly.
    assert_eq!(
        find(&root, &Query::any().role("AXButton").title("SAVE")),
        vec![at(&[0, 3], "Save"), at(&[0, 1, 1], "Save As…")]
    );
    assert_eq!(
        find(&root, &Query::any().role("button").title("Save").exact()),
        vec![at(&[0, 3], "Save")]
    );
    assert_eq!(
        find(&root, &Query::any().title("save")).len(),
        3,
        "the field's title too"
    );
    // The description and the value count as titles.
    assert_eq!(
        find(&root, &Query::any().title("share")),
        vec![at(&[0, 1, 0], "Share")]
    );
    assert_eq!(
        find(&root, &Query::any().title("저장")),
        vec![at(&[0, 2], "저장되지 않음")]
    );
    // A limit stops the walk; nothing matches nothing.
    assert_eq!(find(&root, &Query::any().role("button").limit(1)).len(), 1);
    assert!(find(&root, &Query::any().role("button").limit(0)).is_empty());
    assert!(find(&root, &Query::any().role("AXSlider")).is_empty());
    assert!(
        Query::any()
            .role("button")
            .matches(&Element::new("AXButton"))
    );
    assert!(
        !Query::any()
            .title("Cancel")
            .matches(&Element::new("AXButton").title("OK"))
    );
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

#[test]
fn unicode_text_is_chunked_for_cgevent() {
    // 50 Hangul syllables, one UTF-16 unit each.
    let korean = "안녕하세요반갑습니다".repeat(5);
    let pieces = chunks(&korean, MAX_UNITS);
    assert_eq!(
        pieces.iter().map(|p| units(p)).collect::<Vec<_>>(),
        vec![20, 20, 10]
    );
    assert_eq!(pieces.concat(), korean);

    // Decomposed Hangul (NFD: 한 is three jamo), combining marks, astral characters and emoji
    // sequences never split, and no piece is longer than 20 units.
    let decomposed = "\u{1112}\u{1161}\u{11AB}\u{1100}\u{1173}\u{11AF}".repeat(4);
    let emoji = "👩‍👩‍👧‍👦👍🏽🇰🇷e\u{301}𝒳";
    for text in [
        decomposed.as_str(),
        emoji,
        "가나다라마바사아자차카타파하🙂🙂🙂🙂",
    ] {
        let pieces = chunks(text, MAX_UNITS);
        assert_eq!(pieces.concat(), text);
        for piece in &pieces {
            assert!(
                units(piece) <= MAX_UNITS,
                "{piece:?} is {} units",
                units(piece)
            );
            assert!(!piece.starts_with([
                '\u{1161}',
                '\u{11AB}',
                '\u{301}',
                '\u{200D}',
                '\u{1F3FD}'
            ]));
            assert!(String::from_utf16(&piece.encode_utf16().collect::<Vec<_>>()).is_ok());
        }
    }
    let nfd = chunks(&decomposed, 7);
    assert_eq!(
        nfd.iter().map(|p| units(p)).collect::<Vec<_>>(),
        vec![6, 6, 6, 6]
    );
    // A grapheme longer than a piece is cut between its code points.
    let family = "👩‍👩‍👧‍👦";
    assert_eq!(units(family), 11);
    assert_eq!(chunks(family, 4).concat(), family);
    assert!(chunks(family, 4).iter().all(|p| units(p) <= 4));
}

#[test]
fn typing_turns_line_breaks_and_tabs_into_keys() {
    let none = Modifiers::default();
    let key = |key| {
        [
            Event::KeyDown {
                key,
                modifiers: none,
            },
            Event::KeyUp {
                key,
                modifiers: none,
            },
        ]
    };
    let text = |t: &str| Event::Text { text: t.to_owned() };
    let mut expected = vec![text("첫 줄")];
    expected.extend(key(Key::Return));
    expected.extend(key(Key::Return));
    expected.push(text("a"));
    expected.extend(key(Key::Tab));
    expected.push(text("b"));
    expected.extend(key(Key::Return));
    assert_eq!(plan_text("첫 줄\r\n\na\tb\r").unwrap(), expected);
    for bad in ["", "esc\u{1b}", "nul\0"] {
        assert_eq!(
            plan_text(bad).unwrap_err().code,
            ErrorCode::InvalidParams,
            "{bad:?}"
        );
    }
    assert!(plan_text(&"가".repeat(10_001)).is_err());
}

#[test]
fn chords_parse_and_have_mac_key_codes() {
    let chord = Chord::parse("Cmd+Shift+T").unwrap();
    assert_eq!(chord.key, Key::Char('t'));
    assert!(chord.modifiers.command && chord.modifiers.shift && !chord.modifiers.option);
    assert_eq!(chord.to_string(), "shift+cmd+t");
    let question = Chord::parse("cmd+?").unwrap();
    assert_eq!(
        (question.key, question.modifiers.shift),
        (Key::Char('/'), true)
    );
    assert_eq!(Chord::parse("ctrl+opt+f12").unwrap().key, Key::F(12));
    assert_eq!(Chord::parse("cmd++").unwrap().key, Key::Char('='));
    assert_eq!(Chord::parse("shift").unwrap().key, Key::Shift);
    for bad in ["", "cmd+", "cmd+hyper+a", "cmd+é", "f21", "a+b"] {
        assert!(Chord::parse(bad).is_err(), "{bad:?}");
    }
    let chars = [
        ('a', 0x00),
        ('t', 0x11),
        ('0', 0x1D),
        ('/', 0x2C),
        ('`', 0x32),
    ];
    let named = [
        (Key::Return, 0x24),
        (Key::Escape, 0x35),
        (Key::Up, 0x7E),
        (Key::F(20), 0x5A),
    ];
    let codes = chars.map(|(c, code)| (Key::Char(c), code)).into_iter();
    for (key, code) in codes
        .chain(named)
        .chain([(Key::Command, 0x37), (Key::F(1), 0x7A)])
    {
        assert_eq!(mac_code(key), Some(code), "{key:?}");
    }
    assert_eq!(mac_code(Key::Char('ㅎ')), None);
}

#[test]
fn captures_fit_their_bounds() {
    let display = Rect::new(0.0, 0.0, 1440.0, 900.0);
    assert_eq!(
        Capture::of(Target::MainDisplay)
            .pixels(display, 2.0)
            .unwrap(),
        (2880, 1800)
    );
    let fit = Capture::of(Target::MainDisplay).fit(1280, 1280);
    assert_eq!(fit.pixels(display, 2.0).unwrap(), (1280, 800));
    assert_eq!(
        fit.pixels(Rect::new(0.0, 0.0, 10.0, 5.0), 1.0).unwrap(),
        (10, 5),
        "never enlarged"
    );
    assert!(fit.pixels(Rect::new(0.0, 0.0, 0.0, 5.0), 1.0).is_err());
}
