//! An app window's right-click menu (#235): Chromium's own, with only what edits the page's text
//! (undo, redo, cut, copy, paste, delete, select all, the spelling suggestions). Back, forward,
//! reload, print, view source and the rest are a browser's, not an app's. A menu left with nothing
//! does not show; a page that shows a menu of its own (`contextmenu`'s `preventDefault`) never gets
//! here.

use cef::*;

/// Whether the menu keeps the item with command `id` (CEF's `cef_menu_id_t`).
pub fn keeps(id: i32) -> bool {
    // MENU_ID_UNDO ..= MENU_ID_SELECT_ALL, then the spelling suggestions and their two neighbours.
    (110..=117).contains(&id) || (200..=206).contains(&id)
}

/// One item of the menu as CEF lists it: its command id, or a separator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    Command(i32),
    Separator,
}

/// The indices to remove from `items`, last first: the commands the menu does not keep, and the
/// separators left at an end or next to another.
pub fn removed(items: &[Item]) -> Vec<usize> {
    let mut kept: Vec<(usize, Item)> = Vec::new();
    let mut gone = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let keep = match item {
            Item::Command(id) => keeps(*id),
            Item::Separator => kept.last().is_some_and(|(_, i)| *i != Item::Separator),
        };
        if keep {
            kept.push((index, *item));
        } else {
            gone.push(index);
        }
    }
    if let Some(&(index, Item::Separator)) = kept.last() {
        gone.push(index);
    }
    gone.sort_unstable_by(|a, b| b.cmp(a));
    gone
}

wrap_context_menu_handler! {
    pub struct AppMenu;

    impl ContextMenuHandler {
        fn on_before_context_menu(
            &self,
            _browser: Option<&mut Browser>,
            _frame: Option<&mut Frame>,
            _params: Option<&mut ContextMenuParams>,
            model: Option<&mut MenuModel>,
        ) {
            let Some(model) = model else { return };
            let separator = sys::cef_menu_item_type_t::MENUITEMTYPE_SEPARATOR;
            let items: Vec<Item> = (0..model.count())
                .map(|i| {
                    if sys::cef_menu_item_type_t::from(model.type_at(i)) == separator {
                        Item::Separator
                    } else {
                        Item::Command(model.command_id_at(i))
                    }
                })
                .collect();
            for index in removed(&items) {
                model.remove_at(index);
            }
        }
    }
}
