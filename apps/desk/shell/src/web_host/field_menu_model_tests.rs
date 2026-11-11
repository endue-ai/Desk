use super::*;

/// Everything the field can do now.
const ALL: u32 = 1 | 2 | 4 | 8 | 16 | 32 | 64;

fn labels(entries: &[Entry]) -> Vec<(&str, bool)> {
    entries
        .iter()
        .map(|e| match e {
            Entry::Item { label, enabled, .. } => (*label, *enabled),
            Entry::Separator => ("-", false),
        })
        .collect()
}

#[test]
fn a_field_offers_undo_redo_cut_copy_paste_and_select_all_as_its_state_allows() {
    let all = field(ALL, true);
    assert_eq!(
        labels(&all),
        [
            ("Undo", true),
            ("Redo", true),
            ("-", false),
            ("Cut", true),
            ("Copy", true),
            ("Paste", true),
            ("-", false),
            ("Select All", true),
        ]
    );
    // Nothing selected, nothing to undo: Paste and Select All only.
    let some = field(16 | 64, true);
    let on: Vec<&str> = (labels(&some).into_iter())
        .filter(|(_, enabled)| *enabled)
        .map(|(label, _)| label)
        .collect();
    assert_eq!(on, ["Paste", "Select All"]);
    assert!(matches!(
        &all[4],
        Entry::Item {
            keys: "⌘C",
            command: COPY,
            ..
        }
    ));
    assert!(matches!(
        &field(ALL, false)[4],
        Entry::Item { keys: "Ctrl+C", .. }
    ));
    assert_eq!(labels(&selection(true)), [("Copy", true)]);
}

#[test]
fn the_ids_are_cefs() {
    use cef::sys::cef_menu_id_t as Id;
    assert_eq!(UNDO, Id::MENU_ID_UNDO as i32);
    assert_eq!(REDO, Id::MENU_ID_REDO as i32);
    assert_eq!(CUT, Id::MENU_ID_CUT as i32);
    assert_eq!(COPY, Id::MENU_ID_COPY as i32);
    assert_eq!(PASTE, Id::MENU_ID_PASTE as i32);
    assert_eq!(SELECT_ALL, Id::MENU_ID_SELECT_ALL as i32);
}

#[test]
fn it_opens_below_right_of_the_pointer_and_flips_where_the_view_has_no_room() {
    let placed = place(field(ALL, true), (40.0, 30.0), (400.0, 263.0));
    // Six rows and two separators between the paddings.
    assert_eq!((placed.x, placed.y), (41.0, 31.0));
    assert_eq!(placed.h, PAD * 2.0 + ROW * 6.0 + SEPARATOR * 2.0);
    assert_eq!(placed.rows[0], (PAD, ROW));
    assert_eq!(placed.rows[2], (PAD + ROW * 2.0, SEPARATOR));
    // Near the right and bottom edges: left of and above the pointer.
    let flipped = place(field(ALL, true), (390.0, 250.0), (400.0, 263.0));
    assert_eq!((flipped.x, flipped.y), (390.0 - WIDTH, 250.0 - flipped.h));
    // A view smaller than the menu: as much of it as fits, from the top left.
    let small = place(field(ALL, true), (10.0, 10.0), (120.0, 90.0));
    assert_eq!((small.x, small.y), (0.0, 0.0));
}

#[test]
fn only_enabled_items_are_hit_and_stepped_to() {
    let placed = place(field(16 | 64, true), (0.0, 0.0), (800.0, 600.0));
    let (x, y) = (placed.x + 20.0, placed.y);
    let middle = |row: usize| y + placed.rows[row].0 + placed.rows[row].1 / 2.0;
    assert_eq!(placed.item_at(x, middle(5)), Some(5), "Paste");
    assert_eq!(placed.item_at(x, middle(3)), None, "Cut, off");
    assert_eq!(placed.item_at(x, middle(2)), None, "a separator");
    assert_eq!(
        placed.item_at(placed.x + WIDTH + 1.0, middle(5)),
        None,
        "outside"
    );
    assert_eq!(placed.step(None, false), Some(5));
    assert_eq!(placed.step(Some(5), false), Some(7));
    assert_eq!(placed.step(Some(7), false), Some(7), "the last stays");
    assert_eq!(placed.step(None, true), Some(7));
    assert_eq!(placed.step(Some(7), true), Some(5));
    assert_eq!(placed.command(5), Some(PASTE));
    assert_eq!(placed.command(3), None);
}

fn open() -> (Open, impl Fn(usize) -> (f64, f64)) {
    let placed = place(field(ALL, true), (100.0, 100.0), (800.0, 600.0));
    let (x, y) = (placed.x + 30.0, placed.y);
    let rows = placed.rows.clone();
    let middle = move |row: usize| (x, y + rows[row].0 + rows[row].1 / 2.0);
    (Open::new(placed, (100.0, 100.0)), middle)
}

#[test]
fn a_click_on_an_item_chooses_it_and_one_elsewhere_dismisses_the_menu() {
    let (mut menu, middle) = open();
    let (x, y) = middle(5);
    assert_eq!(menu.hear(Input::Move(x, y)), Then::Redraw);
    assert_eq!(menu.hover, Some(5));
    assert_eq!(menu.hear(Input::Move(x + 1.0, y)), Then::Take, "same row");
    assert_eq!(menu.hear(Input::Down { x, y, right: false }), Then::Take);
    assert_eq!(
        menu.hear(Input::Up { x, y, right: false }),
        Then::Choose(PASTE)
    );
    let (mut menu, middle) = open();
    let (x, y) = middle(2);
    assert_eq!(
        menu.hear(Input::Down { x, y, right: false }),
        Then::Take,
        "a separator"
    );
    assert_eq!(menu.hear(Input::Up { x, y, right: false }), Then::Take);
    let down = Input::Down {
        x: 5.0,
        y: 5.0,
        right: false,
    };
    assert_eq!(menu.hear(down), Then::Dismiss);
    assert_eq!(menu.hear(Input::Wheel), Then::Dismiss);
}

#[test]
fn a_held_right_press_chooses_where_it_is_let_go_but_not_where_it_opened() {
    let (mut menu, middle) = open();
    let opened = Input::Up {
        x: 100.0,
        y: 100.0,
        right: true,
    };
    assert_eq!(
        menu.hear(opened),
        Then::Take,
        "a right click leaves it open"
    );
    let (x, y) = middle(4);
    menu.hear(Input::Move(x, y));
    assert_eq!(
        menu.hear(Input::Up { x, y, right: true }),
        Then::Choose(COPY)
    );
    let (mut menu, _) = open();
    menu.hear(Input::Move(10.0, 10.0));
    let off = Input::Up {
        x: 10.0,
        y: 10.0,
        right: true,
    };
    assert_eq!(menu.hear(off), Then::Dismiss);
}

#[test]
fn keys_move_the_highlight_choose_and_dismiss() {
    let (mut menu, _) = open();
    assert_eq!(
        menu.hear(Input::Key("Enter")),
        Then::Take,
        "nothing highlighted"
    );
    assert_eq!(menu.hear(Input::Key("ArrowDown")), Then::Redraw);
    assert_eq!(menu.hover, Some(0));
    menu.hear(Input::Key("ArrowDown"));
    menu.hear(Input::Key("ArrowDown"));
    assert_eq!(menu.hover, Some(3), "past the separator");
    menu.hear(Input::Key("ArrowUp"));
    assert_eq!(menu.hear(Input::Key("Enter")), Then::Choose(REDO));
    let (mut menu, _) = open();
    assert_eq!(menu.hear(Input::Key("a")), Then::Take);
    assert_eq!(menu.hear(Input::Typed), Then::Take);
    assert_eq!(menu.hear(Input::KeyUp), Then::Pass);
    assert_eq!(menu.hear(Input::Key("Escape")), Then::Dismiss);
    assert_eq!(menu.hear(Input::Blur), Then::Dismiss);
}

#[test]
fn the_page_draws_what_the_shell_placed() {
    let (mut menu, middle) = open();
    let (x, y) = middle(0);
    menu.hear(Input::Move(x, y));
    let spec = menu.placed.spec(menu.hover);
    assert_eq!(spec["x"], menu.placed.x);
    assert_eq!(spec["w"], WIDTH);
    assert_eq!(spec["hover"], 0);
    assert_eq!(spec["rows"][0]["label"], "Undo");
    assert_eq!(spec["rows"][0]["keys"], "⌘Z");
    assert_eq!(spec["rows"][2]["separator"], true);
    assert_eq!(spec["rows"].as_array().map(Vec::len), Some(8));
    assert_eq!(menu.placed.spec(None)["hover"], -1);
}
