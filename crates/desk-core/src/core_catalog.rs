//! catalog.get: what a view, or the brain writing one, can use on this desk. It needs no scope and
//! spends no grant: the caller sees every view component, the connectors with instances whose
//! kinds its `data:read` grants cover (with the fields their items have, as the browser stub's
//! `fieldsOf` finds them), and the commands its `cmd:invoke` grants cover.

use std::collections::BTreeSet;

use desk_bridge::{
    CatalogConnector, CatalogGetResult, ComponentType, DataReadPermission, ItemKind, ItemQuery,
    Permission,
};
use desk_index::DataReadScope;
use serde_json::json;

use crate::handler::{Answer, Core, json as answer};
use crate::perm::Target;

/// Every component, in the spec's order.
const COMPONENTS: [ComponentType; 10] = [
    ComponentType::List,
    ComponentType::Table,
    ComponentType::Card,
    ComponentType::Detail,
    ComponentType::Calendar,
    ComponentType::Agenda,
    ComponentType::Kanban,
    ComponentType::Chart,
    ComponentType::Markdown,
    ComponentType::Stat,
];

/// Items per connector and kind whose fields are enough for the catalog: the newest ones.
const SAMPLE: u64 = 500;

impl Core {
    pub(crate) fn catalog_get(&self, caller: &str) -> Answer {
        let mut infos = self.builtin_infos();
        infos.extend(self.plugin_connector_infos());
        infos.sort_by(|a, b| a.id.cmp(&b.id));
        let mut connectors = Vec::new();
        for info in infos.into_iter().filter(|info| !info.instances.is_empty()) {
            let mut kinds = Vec::new();
            for kind in info.resources.iter().map(|r| r.kind) {
                if self.reads(caller, &info.id, kind)
                    && !kinds
                        .iter()
                        .any(|k: &desk_bridge::CatalogKind| k.kind == kind)
                {
                    kinds.push(desk_bridge::CatalogKind {
                        kind,
                        fields: self.fields(&info.id, kind),
                    });
                }
            }
            if !kinds.is_empty() {
                connectors.push(CatalogConnector {
                    id: info.id,
                    instances: info.instances.into_iter().map(|i| i.instance).collect(),
                    kinds,
                });
            }
        }
        answer(CatalogGetResult {
            components: COMPONENTS.to_vec(),
            connectors,
            commands: self.commands_covered(caller),
        })
    }

    /// Whether a `data:read` grant of the caller covers `kind` from `connector`.
    fn reads(&self, caller: &str, connector: &str, kind: ItemKind) -> bool {
        let scope = Permission::DataRead(DataReadPermission {
            permission: Default::default(),
            kinds: Some(vec![kind]),
            sources: Some(vec![connector.to_owned()]),
        });
        let permissions = self.permissions();
        permissions.authorize(caller, &scope, &Target::None).is_ok()
    }

    /// The top-level fields of the connector's newest items of `kind`, and `raw.<key>`, sorted.
    fn fields(&self, connector: &str, kind: ItemKind) -> Vec<String> {
        let query = json!({ "kinds": [kind], "sources": [connector], "limit": SAMPLE });
        let (Ok(index), Ok(query)) = (self.index(), serde_json::from_value::<ItemQuery>(query))
        else {
            return Vec::new();
        };
        let Ok(page) = index.query(&query, &DataReadScope::all()) else {
            return Vec::new();
        };
        let mut fields = BTreeSet::new();
        for item in &page.items {
            let Ok(serde_json::Value::Object(item)) = serde_json::to_value(item) else {
                continue;
            };
            for (key, value) in item {
                match (key.as_str(), value) {
                    ("raw", serde_json::Value::Object(raw)) => {
                        fields.extend(raw.keys().map(|k| format!("raw.{k}")));
                    }
                    _ => {
                        fields.insert(key);
                    }
                }
            }
        }
        fields.into_iter().collect()
    }
}
