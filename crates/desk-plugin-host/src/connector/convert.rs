//! Between the connector world's WIT types and specs/item/v0: the host stamps `source` on every
//! item a guest sends, merges its `details` in, and checks it against the generated `Item`.

use desk_bridge::{Item, ItemKind as JsonKind, ItemPage, ItemQuery, ItemSource};
use serde_json::Value;

use crate::bindings::Error;
use crate::connector::instances::invalid;
use crate::connector_bindings::{Item as GuestItem, ItemChange, ItemKind, SyncResult};
use crate::connector_bindings::{ItemPage as GuestPage, ItemQuery as GuestQuery};

/// The envelope's fields, which `details` cannot name.
const ENVELOPE: [&str; 9] = [
    "id",
    "source",
    "kind",
    "title",
    "updatedAt",
    "createdAt",
    "deepLink",
    "body",
    "raw",
];

/// A page holds 50 items when the query does not say, and 500 at most (specs/item/v0).
const LIMIT: (u64, u64) = (50, 500);

/// One sync round's changes: the upserted items, checked and stamped with `source`, and the ids
/// of the removed ones. One item that does not fit fails them all, naming it.
pub(crate) fn changes(
    result: SyncResult,
    source: &ItemSource,
) -> Result<(Vec<Item>, Vec<String>), Error> {
    let (mut upserted, mut removed) = (Vec::new(), Vec::new());
    for change in result.changes {
        match change {
            ItemChange::Upserted(item) => upserted.push(item_of(item, source)?),
            ItemChange::Removed(id) => removed.push(id),
        }
    }
    Ok((upserted, removed))
}

/// A live query's page, every item checked and stamped with `source`.
pub(crate) fn page(page: GuestPage, source: &ItemSource) -> Result<ItemPage, Error> {
    let items = page.items.into_iter().map(|item| item_of(item, source));
    Ok(ItemPage {
        items: items.collect::<Result<_, _>>()?,
        cursor: page.cursor,
    })
}

/// An `ItemQuery` for one instance, as the guest takes it: `where` and `sort` as JSON text, the
/// limit 1 to 500 (50 when absent). `sources` is the host's to apply, not the guest's.
pub(crate) fn query(query: &ItemQuery) -> Result<GuestQuery, Error> {
    let limit = query.limit.unwrap_or(LIMIT.0);
    if !(1..=LIMIT.1).contains(&limit) {
        return Err(invalid(format!(
            "a query's limit is 1 to {}, not {limit}",
            LIMIT.1
        )));
    }
    Ok(GuestQuery {
        kinds: query.kinds.iter().flatten().map(|&k| kind(k)).collect(),
        text: query.text.clone(),
        // Generated types always serialize.
        conditions: query
            .r#where
            .as_ref()
            .map(|w| serde_json::to_string(w).unwrap_or_default()),
        sort: query
            .sort
            .as_ref()
            .map(|s| serde_json::to_string(s).unwrap_or_default()),
        cursor: query.cursor.clone(),
        limit: u32::try_from(limit).unwrap_or(u32::MAX),
    })
}

/// The item the guest sent, with `source` stamped on it and its `details` merged in, checked by
/// deserializing it into the generated `Item`.
fn item_of(item: GuestItem, source: &ItemSource) -> Result<Item, Error> {
    let id = item.id.clone();
    let wrong = |why: String| invalid(format!("item {id:?} does not fit specs/item/v0: {why}"));
    let mut fields = match serde_json::from_str::<Value>(&item.details) {
        Ok(Value::Object(fields)) => fields,
        Ok(_) => return Err(wrong("details is not a JSON object".into())),
        Err(e) => return Err(wrong(format!("details is not JSON: {e}"))),
    };
    if let Some(name) = ENVELOPE.iter().find(|name| fields.contains_key(**name)) {
        return Err(wrong(format!(
            "details names {name}, which the envelope holds"
        )));
    }
    let raw = match item.raw.as_deref().map(serde_json::from_str::<Value>) {
        None => None,
        Some(Ok(raw)) => Some(raw),
        Some(Err(e)) => return Err(wrong(format!("raw is not JSON: {e}"))),
    };
    let source = serde_json::to_value(source).unwrap_or_default();
    let envelope = [
        ("id", Some(Value::String(item.id))),
        ("source", Some(source)),
        ("kind", Some(Value::String(kind_name(item.kind).into()))),
        ("title", Some(Value::String(item.title))),
        ("updatedAt", Some(Value::String(item.updated_at))),
        ("createdAt", item.created_at.map(Value::String)),
        ("deepLink", item.deep_link.map(Value::String)),
        ("body", item.body.map(Value::String)),
        ("raw", raw),
    ];
    for (name, value) in envelope {
        if let Some(value) = value {
            fields.insert(name.to_owned(), value);
        }
    }
    serde_json::from_value(Value::Object(fields)).map_err(|e| wrong(e.to_string()))
}

fn kind_name(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Event => "event",
        ItemKind::Message => "message",
        ItemKind::Task => "task",
        ItemKind::Note => "note",
        ItemKind::File => "file",
        ItemKind::Person => "person",
        ItemKind::Entry => "entry",
        ItemKind::Metric => "metric",
        ItemKind::Record => "record",
    }
}

fn kind(kind: JsonKind) -> ItemKind {
    match kind {
        JsonKind::Event => ItemKind::Event,
        JsonKind::Message => ItemKind::Message,
        JsonKind::Task => ItemKind::Task,
        JsonKind::Note => ItemKind::Note,
        JsonKind::File => ItemKind::File,
        JsonKind::Person => ItemKind::Person,
        JsonKind::Entry => ItemKind::Entry,
        JsonKind::Metric => ItemKind::Metric,
        JsonKind::Record => ItemKind::Record,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bindings::ErrorCode;

    fn note(details: &str, raw: Option<&str>) -> GuestItem {
        GuestItem {
            id: "a.md".into(),
            kind: ItemKind::Note,
            title: "Alpha".into(),
            updated_at: "2026-10-30T00:00:00Z".into(),
            created_at: None,
            deep_link: Some("file:///notes/a.md".into()),
            body: Some("# Alpha".into()),
            details: details.into(),
            raw: raw.map(str::to_owned),
        }
    }

    fn source() -> ItemSource {
        ItemSource {
            connector: "example.hello-connector".into(),
            instance: "notes".into(),
        }
    }

    #[test]
    fn the_host_stamps_the_source_and_merges_the_details() {
        let item = item_of(
            note(r#"{"path":"/notes/a.md"}"#, Some(r#"{"n":1}"#)),
            &source(),
        );
        let item = serde_json::to_value(item.unwrap()).unwrap();
        assert_eq!(item["source"]["instance"], "notes");
        assert_eq!(item["path"], "/notes/a.md");
        assert_eq!(item["raw"]["n"], 1);
    }

    #[test]
    fn an_item_that_does_not_fit_is_invalid_params_naming_it() {
        let wrong = [
            note(
                r#"{"source":{"connector":"other.app","instance":"x"}}"#,
                None,
            ),
            note("[]", None),
            note("{", None),
            note(r#"{"colour":"red"}"#, None),
            note("{}", Some("[1]")),
            GuestItem {
                kind: ItemKind::Task,
                ..note("{}", None)
            },
        ];
        for item in wrong {
            let error = item_of(item, &source()).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidParams, "{error:?}");
            assert!(error.message.contains(r#""a.md""#), "{}", error.message);
        }
    }

    #[test]
    fn a_query_takes_1_to_500_items_and_50_by_default() {
        let query = |limit: Option<u64>| {
            let q = ItemQuery {
                kinds: Some(vec![JsonKind::Note]),
                sources: None,
                text: None,
                r#where: None,
                sort: None,
                cursor: None,
                limit,
            };
            super::query(&q).map(|q| (q.limit, q.kinds))
        };
        assert_eq!(query(None).unwrap(), (50, vec![ItemKind::Note]));
        assert_eq!(query(Some(500)).unwrap().0, 500);
        for limit in [0, 501] {
            assert_eq!(
                query(Some(limit)).unwrap_err().code,
                ErrorCode::InvalidParams
            );
        }
    }
}
