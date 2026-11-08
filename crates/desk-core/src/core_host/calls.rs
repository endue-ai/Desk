//! The connector host's `net.fetch`, `settings.*` and `log.*`: each is the core's bridge handler
//! called as the plugin (`CoreHost::ask`) with the narrowest scope its grants must cover, the WIT's
//! types mapped to the bridge's and back.

use std::collections::BTreeMap;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use desk_bridge::{Encoding, NetFetchResult};
use desk_plugin_host::{Error, ErrorCode, LogEntry, LogLevel, Request, Response, Setting};
use serde_json::{Value, json};

use super::{CoreHost, internal};
use crate::http_binding::host_of;

impl CoreHost {
    /// net.fetch under `net:fetch` for the URL's host and port, which desk-sys also takes as the
    /// allowlist, so a redirect is followed only within it, as for http connectors. The method goes
    /// upper-cased (empty: GET), the body as base64; the response body comes back as bytes.
    pub(super) fn fetch(&self, plugin: &str, request: Request) -> Result<Response, Error> {
        let host = host_of(&request.url).ok_or_else(|| Error {
            code: ErrorCode::InvalidParams,
            message: format!("net.fetch: {:?} is not a URL with a host", request.url),
        })?;
        let scope = json!({ "permission": "net:fetch", "hosts": [host] });
        let mut params = json!({ "url": request.url, "scope": scope });
        if !request.method.is_empty() {
            params["method"] = json!(request.method.to_ascii_uppercase());
        }
        if !request.headers.is_empty() {
            // The bridge's headers are a map: of two with one name, the last wins.
            let headers: BTreeMap<String, String> = request.headers.into_iter().collect();
            params["headers"] = json!(headers);
        }
        if let Some(body) = request.body {
            params["body"] = json!(STANDARD.encode(body));
            params["bodyEncoding"] = json!("base64");
        }
        if let Some(timeout) = request.timeout_ms {
            params["timeoutMs"] = json!(timeout);
        }
        let fetched = self.ask(plugin, "net.fetch", params)?;
        let fetched: NetFetchResult =
            serde_json::from_value(fetched).map_err(|e| internal(e.to_string()))?;
        let body = match fetched.body_encoding {
            Encoding::Utf8 => fetched.body.into_bytes(),
            Encoding::Base64 => STANDARD
                .decode(fetched.body)
                .map_err(|e| internal(e.to_string()))?,
        };
        Ok(Response {
            status: u16::try_from(fetched.status).map_err(|e| internal(e.to_string()))?,
            headers: fetched.headers.into_iter().collect(),
            body,
        })
    }

    /// settings.get of the plugin's own key, or of another owner's under `settings:read` for that
    /// one `owner/key`.
    pub(super) fn setting(
        &self,
        plugin: &str,
        key: &str,
        owner: Option<&str>,
    ) -> Result<Option<Value>, Error> {
        let mut params = json!({ "key": key });
        if let Some(owner) = owner.filter(|owner| *owner != plugin) {
            params["owner"] = json!(owner);
            let keys = [format!("{owner}/{key}")];
            params["scope"] = json!({ "permission": "settings:read", "keys": keys });
        }
        let got = self.ask(plugin, "settings.get", params)?;
        Ok(got.get("value").cloned())
    }

    /// settings.set of one of the plugin's own settings.
    pub(super) fn set_setting(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        let params = json!({ "key": key, "value": value });
        self.ask(plugin, "settings.set", params).map(drop)
    }

    /// settings.list: the plugin's own, or with `others` what each of its `settings:read` grants
    /// covers, merged by owner and key; holding none is `permission-denied`.
    pub(super) fn settings(&self, plugin: &str, others: bool) -> Result<Vec<Setting>, Error> {
        let scopes = if others {
            let reads = self.reads(plugin)?;
            if reads.is_empty() {
                return Err(Error {
                    code: ErrorCode::PermissionDenied,
                    message: format!(
                        "settings.list of other owners needs a settings:read grant, which {plugin} \
                         does not hold"
                    ),
                });
            }
            reads.into_iter().map(Some).collect()
        } else {
            vec![None]
        };
        let mut merged: BTreeMap<(String, String), Value> = BTreeMap::new();
        for scope in scopes {
            let params = scope.map_or_else(|| json!({}), |scope| json!({ "scope": scope }));
            let listed = self.ask(plugin, "settings.list", params)?;
            for setting in listed["settings"].as_array().into_iter().flatten() {
                let text = |name: &str| setting[name].as_str().unwrap_or_default().to_owned();
                merged.insert((text("owner"), text("key")), setting["value"].clone());
            }
        }
        Ok(merged
            .into_iter()
            .map(|((owner, key), value)| Setting {
                owner,
                key,
                value: value.to_string(),
            })
            .collect())
    }

    /// The permissions of the plugin's `settings:read` grants.
    fn reads(&self, plugin: &str) -> Result<Vec<Value>, Error> {
        let grants = self.ask(plugin, "perm.query", json!({}))?;
        Ok(grants["grants"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|grant| grant["permission"].clone())
            .filter(|permission| permission["permission"] == "settings:read")
            .collect())
    }

    /// log.write to the plugin's own channel.
    pub(super) fn log(
        &self,
        plugin: &str,
        level: LogLevel,
        message: &str,
        fields: Option<Value>,
    ) -> Result<(), Error> {
        let level = match level {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        };
        let mut params = json!({ "level": level, "message": message });
        if let Some(fields) = fields {
            params["fields"] = fields;
        }
        self.ask(plugin, "log.write", params).map(drop)
    }

    /// log.tail under `log:read`.
    pub(super) fn tail(
        &self,
        plugin: &str,
        channel: Option<&str>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        let mut params = json!({ "scope": { "permission": "log:read" } });
        if let Some(channel) = channel {
            params["channel"] = json!(channel);
        }
        if let Some(count) = count {
            params["count"] = json!(count);
        }
        let tail = self.ask(plugin, "log.tail", params)?;
        let entries: Vec<desk_bridge::LogEntry> =
            serde_json::from_value(tail["entries"].clone()).map_err(|e| internal(e.to_string()))?;
        Ok(entries
            .into_iter()
            .map(|entry| LogEntry {
                at: entry.at,
                channel: entry.channel,
                level: match entry.level {
                    desk_bridge::LogLevel::Debug => LogLevel::Debug,
                    desk_bridge::LogLevel::Info => LogLevel::Info,
                    desk_bridge::LogLevel::Warn => LogLevel::Warn,
                    desk_bridge::LogLevel::Error => LogLevel::Error,
                },
                message: entry.message,
                fields: entry.fields.map(|fields| Value::Object(fields).to_string()),
            })
            .collect())
    }
}
