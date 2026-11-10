//! The spread for assistive technology (ADR 0116, as the runtime's `arrange/spread-view.ts` gave
//! it): a modal dialog whose field is a combobox over a list of the windows' titles, the selected
//! one its active descendant, and the count a polite live region. The field has the keyboard while
//! the spread is open, so the root tree's focus is on it; pressing an option picks its window.

use accesskit::{Action, Live, Node, NodeId, Role};

use super::chrome::{Builder, Does, Press, bounds};
use crate::types::Rect;

/// One window the spread lists.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeOption {
    pub id: String,
    /// Its title, and "asleep" after it when its frame sleeps, in the desk's language.
    pub label: String,
    pub selected: bool,
    /// Where its card is on the window, for a press.
    pub rect: Rect,
}

/// The spread as the compositor draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct ChromeSpread {
    pub label: String,
    /// The field's label, and what is typed in it.
    pub field: String,
    pub filter: String,
    pub field_rect: Rect,
    /// The count ("4 windows") and the hint under the field.
    pub count: String,
    pub hint: String,
    /// The windows the filter lets through, in the spread's order.
    pub options: Vec<ChromeOption>,
}

/// The dialog's nodes; answers the dialog and the field, which takes the focus.
pub(super) fn build(b: &mut Builder<'_>, spread: &ChromeSpread) -> (NodeId, NodeId) {
    let options: Vec<(NodeId, bool)> = (spread.options.iter())
        .map(|o| {
            let mut node = Node::new(Role::ListBoxOption);
            node.set_label(o.label.as_str());
            node.set_selected(o.selected);
            node.set_bounds(bounds(o.rect));
            node.add_action(Action::Click);
            let id = b.put(format!("spread/option/{}", o.id), node);
            let at = (
                o.rect.x + o.rect.width / 2.0,
                o.rect.y + o.rect.height / 2.0,
            );
            b.out.does.insert(id, Does::Press(Press::At(at.0, at.1)));
            (id, o.selected)
        })
        .collect();
    let mut list = Node::new(Role::ListBox);
    list.set_label(spread.label.as_str());
    list.set_children(options.iter().map(|(id, _)| *id).collect::<Vec<_>>());
    let list = b.put("spread/list".into(), list);
    let mut field = Node::new(Role::ComboBox);
    field.set_label(spread.field.as_str());
    field.set_value(spread.filter.as_str());
    field.set_bounds(bounds(spread.field_rect));
    field.set_expanded(true);
    field.set_controls(vec![list]);
    if let Some((selected, _)) = options.iter().find(|(_, selected)| *selected) {
        field.set_active_descendant(*selected);
    }
    field.add_action(Action::Focus);
    let field = b.put("spread/field".into(), field);
    let mut count = Node::new(Role::Label);
    count.set_value(spread.count.as_str());
    count.set_live(Live::Polite);
    let count = b.put("spread/count".into(), count);
    let mut hint = Node::new(Role::Label);
    hint.set_value(spread.hint.as_str());
    let hint = b.put("spread/hint".into(), hint);
    let mut dialog = Node::new(Role::Dialog);
    dialog.set_label(spread.label.as_str());
    dialog.set_modal();
    dialog.set_children(vec![field, count, hint, list]);
    (b.put("spread".into(), dialog), field)
}
