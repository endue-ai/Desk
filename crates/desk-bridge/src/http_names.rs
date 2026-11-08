//! The names an http connector block uses (specs/connector/v0 `HttpBinding`, ADR 0106) that a JSON
//! Schema cannot check: its token is a declared secret setting of a `token` connector, each request's
//! map is one of its maps, each map makes a kind the connector lists and gives `id` and `title`.

use crate::{ConnectorAuthKind, ConnectorManifest};

/// The problems of `connector`'s http block, with JSON pointers under `/connector`.
pub(crate) fn http_problems(connector: &ConnectorManifest) -> Vec<String> {
    let Some(http) = &connector.http else {
        return Vec::new();
    };
    let mut problems = Vec::new();
    if let Some(auth) = &http.auth {
        let setting = connector
            .instance_settings
            .as_ref()
            .and_then(|s| s.get(&auth.setting));
        if !setting.is_some_and(|s| s.secret == Some(true)) {
            problems.push(format!(
                "/connector/http/auth/setting: {} is not a secret instance setting",
                auth.setting
            ));
        }
        if connector.auth.kind != ConnectorAuthKind::Token {
            problems
                .push("/connector/auth/kind: an http block with auth signs in with a token".into());
        }
    }
    for (r, request) in http.requests.iter().enumerate() {
        if !http.maps.contains_key(&request.map) {
            problems.push(format!(
                "/connector/http/requests/{r}/map: {} is not one of the http block's maps",
                request.map
            ));
        }
    }
    for (name, map) in &http.maps {
        if !connector.resources.iter().any(|r| r.kind == map.kind) {
            let kind = serde_json::to_value(map.kind).unwrap_or_default();
            problems.push(format!(
                "/connector/http/maps/{name}/kind: {kind} is not a kind in resources"
            ));
        }
        for field in ["id", "title"] {
            if !map.fields.contains_key(field) {
                problems.push(format!("/connector/http/maps/{name}/fields: no {field}"));
            }
        }
    }
    problems
}
