//! The market for every kind on the core's side (ADR 0107): market.list over the indexes
//! `desk.market.indexes` lists and the theme markets, plugin.install and plugin.remove under
//! plugin:manage. A view or plugin bundle lands in the market folder with a record beside it (the
//! market, the URL, the version, the sha256 and the permissions granted), which plugins.lock reads as
//! `url:` and the next start grants again. Themes and design systems go through theme.import. Code
//! installs only from the endue index.

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{
    BridgeError, ErrorCode, MarketEntry, MarketKind, MarketListParams, MarketListResult,
    MarketListing, MarketProblem, MarketState, PluginInstallParams, PluginInstallResult,
    PluginManagePermission, PluginRemoveParams, PluginRemoveResult, ThemeImportParams,
    ThemeMarketState,
};
use serde_json::Value;

use crate::core_market::{https_host, resolve};
use crate::handler::{Answer, Core, error, io_error, json as answer};
use crate::marketplace::{
    ENDUE_MARKET, RECORDS, Record, describe, kind_of, missing, read_bundle, read_index,
    theme_entry, verified,
};
use crate::perm::Target;
use crate::plugins::{Landing, land_folder};

/// Where market installs land, and the endue index's URL prefix.
pub(crate) struct Market {
    pub(crate) dir: Option<PathBuf>,
    pub(crate) endue: String,
}

impl Default for Market {
    fn default() -> Self {
        Self {
            dir: None,
            endue: ENDUE_MARKET.to_owned(),
        }
    }
}

/// One entry found in a market, with the index it came from.
struct Found {
    market: String,
    entry: MarketEntry,
    verified: bool,
}

impl Core {
    /// Land market installs in `dir` (`<data>/plugins` in the app).
    pub fn with_market_dir(mut self, dir: PathBuf) -> Self {
        self.market.dir = Some(dir);
        self
    }

    /// The endue index's URL prefix: code installs only from an index under it (tests point it at
    /// their own).
    pub fn with_endue_market(mut self, prefix: &str) -> Self {
        self.market.endue = prefix.to_owned();
        self
    }

    /// Install every plugin the market folder holds, granting each the permissions its record
    /// says it was granted. The app calls it once at start, after the built-in plugins.
    pub fn install_market_plugins(&self) {
        let Some(dir) = self.market.dir.clone() else {
            return;
        };
        let _hold = self.hold_lock();
        for folder in crate::plugins::plugin_dirs(&dir) {
            let info = self.install_plugin(&folder, false);
            let granted = self.market_record(&info.id).map(|r| r.permissions);
            let granted = granted.unwrap_or_default();
            self.grant_pack(&info.id, &granted);
            for permission in granted {
                self.grant(&info.id, permission);
            }
        }
    }

    pub(crate) fn market_list(&self, caller: &str, params: MarketListParams) -> Answer {
        self.check_market(caller, params.scope)?;
        let (found, problems) = self.market_entries();
        let entries = found.into_iter().map(|f| self.market_listing(f)).collect();
        answer(MarketListResult { entries, problems })
    }

    pub(crate) fn plugin_install(&self, caller: &str, params: PluginInstallParams) -> Answer {
        self.check_market(caller, params.scope)?;
        let found = self.find(&params.id, params.market.as_deref())?;
        let (entry, market) = (&found.entry, found.market.clone());
        if matches!(entry.kind, MarketKind::Theme | MarketKind::DesignSystem) {
            let import = ThemeImportParams {
                bundle: None,
                path: None,
                url: Some(entry.url.clone()),
                sha256: Some(entry.sha256.clone()),
                market: Some(market),
                scope: desk_bridge::ThemeManagePermission {
                    permission: Default::default(),
                },
            };
            let landed = self.import_theme(import)?;
            return answer(PluginInstallResult {
                plugin: serde_json::from_value(landed["plugin"].clone()).map_err(internal)?,
            });
        }
        if entry.kind == MarketKind::Plugin && !found.verified {
            let why = format!(
                "{} comes from {}, which is not verified: code installs only from the endue index",
                entry.id, found.market
            );
            return Err(error(ErrorCode::PermissionDenied, why));
        }
        let asked = entry.permissions.clone().unwrap_or_default();
        let unaccepted = missing(&asked, &params.accept);
        if !unaccepted.is_empty() {
            let named: Vec<String> = unaccepted.iter().map(describe).collect();
            let why = format!(
                "{} asks {} that was not accepted",
                entry.id,
                named.join(", ")
            );
            return Err(error(ErrorCode::PermissionDenied, why));
        }
        let dir = self.market_dir()?;
        let bytes = self.download(&entry.url, Some(&entry.sha256))?;
        if bytes.len() as u64 != entry.size {
            let why = format!(
                "{}: {} bytes, its market says {}",
                entry.url,
                bytes.len(),
                entry.size
            );
            return Err(error(ErrorCode::InvalidParams, why));
        }
        let (bundle, files) =
            read_bundle(&bytes).map_err(|why| error(ErrorCode::InvalidParams, why))?;
        let manifest = &bundle.manifest;
        if manifest.kind == desk_bridge::PluginKind::Pack {
            let nested = crate::core_packs::nested_manifests(&files);
            crate::core_packs::check_nested_code(
                &entry.id,
                &found.market,
                found.verified,
                &nested,
            )?;
        }
        let same = manifest.id == entry.id && manifest.version == entry.version;
        if !same || kind_of(manifest.kind) != entry.kind {
            let why = format!(
                "the bundle at {} is {} {} ({:?}), not the {} {} its market lists",
                entry.url, manifest.id, manifest.version, manifest.kind, entry.id, entry.version
            );
            return Err(error(ErrorCode::InvalidParams, why));
        }
        let target = dir.join(&entry.id);
        land_folder(&target, manifest, &files).map_err(|landing| match landing {
            Landing::Invalid(problems) => error(ErrorCode::InvalidParams, problems.join("; ")),
            Landing::Io(why) => io_error(why),
        })?;
        let record = Record {
            market: found.market.clone(),
            url: entry.url.clone(),
            version: entry.version.clone(),
            sha256: entry.sha256.clone(),
            permissions: asked.clone(),
        };
        self.keep_record(&entry.id, &record)?;
        self.revoke_all(&entry.id);
        let plugin = self.install_plugin(&target, false);
        self.grant_pack(&entry.id, &asked);
        for permission in asked {
            self.grant(&entry.id, permission);
        }
        answer(PluginInstallResult { plugin })
    }

    pub(crate) fn plugin_remove(&self, caller: &str, params: PluginRemoveParams) -> Answer {
        self.check_market(caller, params.scope)?;
        let id = params.plugin;
        if self.market_record(&id).is_none() {
            if self.plugins().iter().any(|p| p.id == id) {
                let why = format!("{id} was not installed from a market");
                return Err(error(ErrorCode::InvalidParams, why));
            }
            return Err(error(ErrorCode::NotFound, format!("no plugin {id}")));
        }
        let dir = self.market_dir()?;
        let _ = fs::remove_file(self.record_file(&dir, &id));
        self.remove_plugin(&id);
        self.revoke_all(&id);
        let folder = dir.join(&id);
        if folder.exists() {
            fs::remove_dir_all(&folder).map_err(io_error)?;
        }
        answer(PluginRemoveResult {})
    }

    /// `url:<bundle URL>` for plugins.lock when the market installed `id`.
    pub(crate) fn market_source(&self, id: &str) -> Option<String> {
        self.market_record(id)
            .map(|record| format!("url:{}", record.url))
    }

    /// Every entry of the markets in force, each id once (the first market wins), and the markets
    /// that could not be read. Market indexes first, then the theme markets.
    fn market_entries(&self) -> (Vec<Found>, Vec<MarketProblem>) {
        let (mut found, mut problems) = (Vec::<Found>::new(), Vec::new());
        let push = |market: &str, entry: MarketEntry, found: &mut Vec<Found>| {
            if found.iter().any(|f| f.entry.id == entry.id) {
                return;
            }
            let verified = verified(market, &self.market.endue);
            found.push(Found {
                market: market.to_owned(),
                entry,
                verified,
            });
        };
        for market in self.market_indexes() {
            let read = match https_host(&market) {
                None => Err(format!("{market} is not an https URL")),
                Some(_) => self.get(&market).and_then(|bytes| read_index(&bytes)),
            };
            match read {
                Ok(index) => {
                    for mut entry in index.entries {
                        entry.url = resolve(&market, &entry.url);
                        push(&market, entry, &mut found);
                    }
                }
                Err(message) => problems.push(MarketProblem { market, message }),
            }
        }
        for market in self.markets() {
            match self.read_index(&market) {
                Ok(index) => {
                    for mut theme in index.themes {
                        theme.url = resolve(&market, &theme.url);
                        push(&market, theme_entry(theme), &mut found);
                    }
                }
                Err(message) => problems.push(MarketProblem { market, message }),
            }
        }
        (found, problems)
    }

    fn find(&self, id: &str, market: Option<&str>) -> Result<Found, BridgeError> {
        let (found, problems) = self.market_entries();
        let mut candidates = found.into_iter().filter(|f| f.entry.id == id);
        let hit = match market {
            Some(market) => candidates.find(|f| f.market == market),
            None => candidates.next(),
        };
        hit.ok_or_else(|| {
            let unread: Vec<String> = problems.into_iter().map(|p| p.market).collect();
            let more = if unread.is_empty() {
                String::new()
            } else {
                format!(" ({} could not be read)", unread.join(", "))
            };
            error(
                ErrorCode::NotFound,
                format!("no market in force lists {id}{more}"),
            )
        })
    }

    /// How a found entry stands on this desk.
    fn market_listing(&self, found: Found) -> MarketListing {
        let Found {
            market,
            entry,
            verified,
        } = found;
        let asked = entry.permissions.clone().unwrap_or_default();
        let (state, installed, given) =
            if matches!(entry.kind, MarketKind::Theme | MarketKind::DesignSystem) {
                let theme = self.theme_state(&entry);
                (theme.0, theme.1, Vec::new())
            } else {
                let plugin = self.plugins().into_iter().find(|p| p.id == entry.id);
                let version = plugin.and_then(|p| p.manifest).map(|m| m.version);
                let record = self.market_record(&entry.id);
                let state = match (&version, &record) {
                    (None, _) => MarketState::Available,
                    (Some(v), Some(r)) if *v == entry.version && r.sha256 == entry.sha256 => {
                        MarketState::Installed
                    }
                    (Some(v), None) if *v == entry.version => MarketState::Installed,
                    _ => MarketState::Update,
                };
                let given = if version.is_some() {
                    record.map(|r| r.permissions).unwrap_or_default()
                } else {
                    Vec::new()
                };
                (state, version, given)
            };
        let added = missing(&asked, &given);
        MarketListing {
            market,
            entry,
            verified,
            state,
            installed,
            added,
        }
    }

    /// A theme market entry's state, as theme.market.list says it.
    fn theme_state(&self, entry: &MarketEntry) -> (MarketState, Option<String>) {
        let (state, version) = self.market_state(&entry.id, &entry.sha256);
        let state = match state {
            ThemeMarketState::Available => MarketState::Available,
            ThemeMarketState::Installed => MarketState::Installed,
            _ => MarketState::Update,
        };
        (state, version)
    }

    /// The indexes `desk.market.indexes` lists: the runtime's, else the `desk.market` manifest's.
    fn market_indexes(&self) -> Vec<String> {
        let value = self.setting_in_force("desk", "market.indexes");
        let value = value.or_else(|| self.setting_in_force("desk.market", "indexes"));
        let mut urls: Vec<String> = Vec::new();
        for url in value
            .as_ref()
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(url) = url
                .as_str()
                .filter(|u| !urls.iter().any(|known| known == u))
            {
                urls.push(url.to_owned());
            }
        }
        urls
    }

    fn market_record(&self, id: &str) -> Option<Record> {
        let dir = self.market.dir.as_ref()?;
        let text = fs::read(self.record_file(dir, id)).ok()?;
        serde_json::from_slice(&text).ok()
    }

    fn keep_record(&self, id: &str, record: &Record) -> Result<(), BridgeError> {
        let dir = self.market_dir()?;
        let path = self.record_file(&dir, id);
        fs::create_dir_all(path.parent().unwrap_or(&dir)).map_err(io_error)?;
        let text = serde_json::to_vec_pretty(record).map_err(internal)?;
        fs::write(path, text).map_err(io_error)
    }

    fn record_file(&self, dir: &Path, id: &str) -> PathBuf {
        dir.join(RECORDS).join(format!("{id}.json"))
    }

    fn market_dir(&self) -> Result<PathBuf, BridgeError> {
        let dir = self.market.dir.clone();
        dir.ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "this desk has no market folder".into(),
            )
        })
    }

    /// Take back every grant `caller` holds.
    fn revoke_all(&self, caller: &str) {
        let mut permissions = self.permissions();
        let ids: Vec<String> = permissions
            .list()
            .into_iter()
            .filter(|g| g.caller == caller)
            .map(|g| g.grant.grant_id)
            .collect();
        for id in ids {
            permissions.revoke(caller, &id);
        }
    }

    fn check_market(&self, caller: &str, scope: PluginManagePermission) -> Result<(), BridgeError> {
        self.check(
            caller,
            &desk_bridge::Permission::PluginManage(scope),
            &Target::None,
        )
    }
}

fn internal(e: impl std::fmt::Display) -> BridgeError {
    error(ErrorCode::Internal, e.to_string())
}
