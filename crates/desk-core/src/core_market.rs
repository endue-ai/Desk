//! The theme market (ADR 0060, docs/ko/theme-requirements.md TC-05). theme.market.list reads the
//! indexes `desk.theme.markets` lists (specs/plugin `ThemeIndex`) and merges them by id, the first
//! market winning; theme.market.fetch downloads a bundle to preview it, checked against its sha256
//! and as a theme plugin in a temporary folder that goes again. Installing is theme.import by url:
//! beside a `market.` theme the core keeps where it came from (`.market/<id>.json` in the user themes
//! folder) with a hash of its folder as it landed, so an update replaces it only while the person has
//! not changed it. Every download is https, to its URL's host only, through desk-sys `net`. A preview
//! and an install from a market take only a bundle a market in force lists, under the id it lists.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use desk_bridge::{
    BridgeError, ErrorCode, PluginKind, PluginManifest, ThemeBundle, ThemeIndex, ThemeIndexKind,
    ThemeMarketFetchParams, ThemeMarketFetchResult, ThemeMarketListParams, ThemeMarketListResult,
    ThemeMarketProblem, ThemeMarketState, ThemeMarketTheme,
};
use desk_update::verify::sha256_hex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::core_themes::{decode, invalid, parse, too_big};
use crate::handler::{Answer, Core, error, io_error, json as answer};
use crate::manifest::schema_registry;
use crate::plugins::{Landing, land_folder};

const INDEX: &str = "https://endue.ai/specs/plugin/v0/theme-index.schema.json#/$defs/ThemeIndex";
/// Where a market theme's record lives in the user themes folder: hidden, so never a theme.
const RECORDS: &str = ".market";

/// Where a market theme came from, kept beside it as `.market/<id>.json`.
#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Record {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    market: Option<String>,
    url: String,
    version: String,
    sha256: String,
    /// The hash of its folder as it landed: another one means the person changed it since.
    folder: String,
}

impl Core {
    pub(crate) fn theme_market_list(&self, caller: &str, params: ThemeMarketListParams) -> Answer {
        self.check_theme(caller, params.scope)?;
        let (mut themes, mut problems) = (Vec::<ThemeMarketTheme>::new(), Vec::new());
        for market in self.markets() {
            let index = match self.read_index(&market) {
                Ok(index) => index,
                Err(message) => {
                    problems.push(ThemeMarketProblem { market, message });
                    continue;
                }
            };
            for mut theme in index.themes {
                if themes.iter().any(|known| known.theme.id == theme.id) {
                    continue;
                }
                theme.url = resolve(&market, &theme.url);
                let (state, installed) = self.market_state(&theme.id, &theme.sha256);
                let market = market.clone();
                let listed = ThemeMarketTheme {
                    theme,
                    market,
                    state,
                    installed,
                };
                themes.push(listed);
            }
        }
        answer(ThemeMarketListResult { themes, problems })
    }

    pub(crate) fn theme_market_fetch(
        &self,
        caller: &str,
        params: ThemeMarketFetchParams,
    ) -> Answer {
        self.check_theme(caller, params.scope)?;
        let bundle = self.market_bundle(&params.url, Some(&params.sha256), None)?;
        let manifest = &bundle.manifest;
        if !crate::plugins::is_look(manifest.kind) {
            return Err(invalid(format!(
                "{} is not a theme or design system",
                manifest.id
            )));
        }
        let files = decode(manifest, bundle.files.clone().into_iter().collect())?;
        static PREVIEWS: AtomicU64 = AtomicU64::new(0);
        let n = PREVIEWS.fetch_add(1, Ordering::Relaxed);
        let name = format!("desk-theme-preview-{}-{n}", std::process::id());
        let scratch = std::env::temp_dir().join(name);
        let checked = land_folder(&scratch.join("theme"), manifest, &files);
        let _ = fs::remove_dir_all(&scratch);
        checked.map_err(|landing| match landing {
            Landing::Invalid(problems) => invalid(problems.join("; ")),
            Landing::Io(why) => io_error(why),
        })?;
        answer(ThemeMarketFetchResult { bundle })
    }

    /// Before theme.import lands `manifest`: a `market.` theme downloaded by `url` replaces an earlier
    /// one only while that is as its market published it. The record to keep once it lands; none for
    /// a theme from a file or outside `market.`.
    pub(crate) fn market_guard(
        &self,
        manifest: &PluginManifest,
        url: Option<String>,
        sha256: Option<&str>,
        market: Option<String>,
    ) -> Result<Option<Record>, BridgeError> {
        let id = &manifest.id;
        let Some(url) = url.filter(|_| id.starts_with("market.")) else {
            return Ok(None);
        };
        if self.user_theme_dir(id).is_some() && self.unchanged(id).is_none() {
            let why = format!("{id} was changed since a market published it: remove it first");
            return Err(error(ErrorCode::AlreadyExists, why));
        }
        let sha256 = sha256.unwrap_or_default().to_ascii_lowercase();
        let version = manifest.version.clone();
        let folder = String::new();
        Ok(Some(Record {
            market,
            url,
            version,
            sha256,
            folder,
        }))
    }

    /// After theme.import landed `id`: keep `record` with the hash of the folder as it is now, or
    /// forget an earlier one (the theme came from a file, so it is not as any market published it).
    pub(crate) fn market_landed(&self, id: &str, record: Option<Record>) {
        let Some(mut record) = record else {
            return self.forget_market(id);
        };
        let (Some(path), Some(folder)) = (self.record_path(id), self.user_theme_dir(id)) else {
            return;
        };
        record.folder = folder_hash(&folder);
        let text = serde_json::to_vec_pretty(&record).unwrap_or_default();
        let _ = fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = fs::write(&path, text);
    }

    /// Forget where a market theme came from (it was removed, or replaced from a file).
    pub(crate) fn forget_market(&self, id: &str) {
        if let Some(path) = self.record_path(id) {
            let _ = fs::remove_file(path);
        }
    }

    /// The bundle at `url` from a market: `market` for theme.import, or for theme.market.fetch (none)
    /// the first market in force that lists the url. Refused unless that market lists it, its bytes
    /// have `sha256`, and its manifest has the id and the kind the index lists there (TC-05, DT-03).
    pub(crate) fn market_bundle(
        &self,
        url: &str,
        sha256: Option<&str>,
        market: Option<&str>,
    ) -> Result<ThemeBundle, BridgeError> {
        let (listed, kind) = self.listed_id(url, market)?;
        let bundle = parse(&self.download(url, sha256)?)?;
        let id = &bundle.manifest.id;
        if *id != listed {
            let why = format!("the bundle at {url} is {id}, not {listed} as its market lists it");
            return Err(invalid(why));
        }
        let design = bundle.manifest.kind == PluginKind::DesignSystem;
        if design != (kind == Some(ThemeIndexKind::DesignSystem)) {
            let why = format!("the bundle at {url} is not of the kind its market lists");
            return Err(invalid(why));
        }
        Ok(bundle)
    }

    /// The id and kind a market in force lists for the bundle at `url`, `market`'s when one is named. The
    /// indexes are read again for each call rather than remembered from the last theme.market.list,
    /// so the answer is what the markets in force say now, before and after any list.
    fn listed_id(
        &self,
        url: &str,
        market: Option<&str>,
    ) -> Result<(String, Option<ThemeIndexKind>), BridgeError> {
        let mut markets = self.markets();
        if let Some(named) = market {
            if !markets.iter().any(|known| known == named) {
                return Err(invalid(format!("{named} is not a market in force")));
            }
            markets = vec![named.to_owned()];
        }
        let mut unread = String::new();
        for market in &markets {
            match self.read_index(market) {
                Ok(index) => {
                    let mut entries = index.themes.into_iter();
                    if let Some(entry) = entries.find(|t| resolve(market, &t.url) == url) {
                        return Ok((entry.id, entry.kind));
                    }
                }
                Err(why) => unread.push_str(&format!("; {market}: {why}")),
            }
        }
        Err(invalid(match market {
            Some(market) => format!("{market} does not list {url}{unread}"),
            None => format!("no market in force lists {url}{unread}"),
        }))
    }

    /// A bundle by its https URL, refused unless its bytes have `sha256`.
    pub(crate) fn download(&self, url: &str, sha256: Option<&str>) -> Result<Vec<u8>, BridgeError> {
        let Some(sha256) = sha256.filter(|_| https_host(url).is_some()) else {
            return Err(invalid(format!("{url} needs https and a sha256")));
        };
        let bytes = self
            .get(url)
            .map_err(|why| error(ErrorCode::IoError, why))?;
        too_big(url, bytes.len())?;
        let actual = sha256_hex(&bytes);
        if !actual.eq_ignore_ascii_case(sha256) {
            return Err(invalid(format!("{url}: sha256 {actual}, not {sha256}")));
        }
        Ok(bytes)
    }

    /// The market indexes in force: the theme markets (the runtime's `theme.markets`, init.yaml's
    /// `desk.theme.markets`, or the `desk.theme` manifest's default), then the design system markets
    /// (`desk.design.markets` the same way, ADR 0091); each once, in order.
    pub(crate) fn markets(&self) -> Vec<String> {
        let list = |policy: &str, key: &str| {
            let value = self.setting_in_force("desk", &format!("{key}.markets"));
            value.or_else(|| self.setting_in_force(policy, "markets"))
        };
        let values = [list("desk.theme", "theme"), list("desk.design", "design")];
        let mut markets: Vec<String> = Vec::new();
        for url in values
            .iter()
            .flatten()
            .filter_map(Value::as_array)
            .flatten()
        {
            let url = url.as_str().map(str::to_owned);
            if let Some(url) = url.filter(|url| !markets.contains(url)) {
                markets.push(url);
            }
        }
        markets
    }

    /// A market's index, downloaded and checked against `ThemeIndex`, or why not.
    pub(crate) fn read_index(&self, market: &str) -> Result<ThemeIndex, String> {
        if https_host(market).is_none() {
            return Err(format!("{market} is not an https URL"));
        }
        let bytes = self.get(market)?;
        too_big(market, bytes.len()).map_err(|e| e.message)?;
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|e| format!("not a theme index: {e}"))?;
        if let Some(problem) = index_validator().iter_errors(&value).next() {
            let at = problem.instance_path().to_string();
            return Err(format!("not a theme index: {at}: {problem}"));
        }
        serde_json::from_value(value).map_err(|e| format!("not a theme index: {e}"))
    }

    /// How a listed theme stands on this desk, and the version installed.
    pub(crate) fn market_state(
        &self,
        id: &str,
        sha256: &str,
    ) -> (ThemeMarketState, Option<String>) {
        let plugin = self.plugins().into_iter().find(|p| p.id == id);
        let Some(version) = plugin.and_then(|p| p.manifest).map(|m| m.version) else {
            return (ThemeMarketState::Available, None);
        };
        let state = match self.unchanged(id) {
            Some(record) if record.sha256 == sha256 => ThemeMarketState::Installed,
            Some(_) => ThemeMarketState::Update,
            None => ThemeMarketState::Edited,
        };
        (state, Some(version))
    }

    /// The record of a market theme whose folder is still as it landed; none when it was changed,
    /// has no record, or is not a user theme.
    fn unchanged(&self, id: &str) -> Option<Record> {
        let folder = self.user_theme_dir(id)?;
        let text = fs::read(self.record_path(id)?).ok()?;
        let record: Record = serde_json::from_slice(&text).ok()?;
        (record.folder == folder_hash(&folder)).then_some(record)
    }

    fn record_path(&self, id: &str) -> Option<PathBuf> {
        let dir = self.themes_dir().ok()?;
        Some(dir.join(RECORDS).join(format!("{id}.json")))
    }

    /// The bytes at `url`: the fetch a test gave, else desk-sys `net`.
    pub(crate) fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        match &self.themes.fetch {
            Some(fetch) => fetch(url),
            None => https_fetch(url),
        }
    }
}

fn index_validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": INDEX }))
            .expect("the theme index schema compiles")
    })
}

/// An index entry's bundle url made absolute: an https one as it is, a relative one against the
/// folder of the index's URL.
pub(crate) fn resolve(index: &str, url: &str) -> String {
    if url.starts_with("https://") {
        return url.to_owned();
    }
    let base = index.split(['?', '#']).next().unwrap_or(index);
    let rest = base.strip_prefix("https://").unwrap_or(base);
    match rest.rfind('/') {
        Some(at) => format!("https://{}{url}", &rest[..=at]),
        None => format!("https://{rest}/{url}"),
    }
}

/// One hash of every file in a folder, by relative path and bytes: how the core tells a market theme
/// the person changed from one as it landed.
fn folder_hash(dir: &Path) -> String {
    let (mut folders, mut files) = (vec![dir.to_path_buf()], Vec::new());
    while let Some(folder) = folders.pop() {
        for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => folders.push(path),
                Ok(_) => files.push(path),
                Err(_) => {}
            }
        }
    }
    files.sort();
    let mut all = Vec::new();
    for file in files {
        let name = file.strip_prefix(dir).unwrap_or(&file).to_string_lossy();
        let bytes = fs::read(&file).unwrap_or_default();
        all.extend_from_slice(name.replace('\\', "/").as_bytes());
        all.push(0);
        all.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        all.extend_from_slice(&bytes);
    }
    sha256_hex(&all)
}

/// `host:port` of an https URL (443 when it names none): the only host its download may reach.
pub(crate) fn https_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://")?;
    let host = rest.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    let usable = !host.is_empty() && !host.contains(['@', '[', ' ']);
    let port = if host.contains(':') { "" } else { ":443" };
    usable.then(|| format!("{host}{port}"))
}

/// The desk's download: desk-sys `net`, to the URL's host only, for a 2xx answer, within a minute.
fn https_fetch(url: &str) -> Result<Vec<u8>, String> {
    let request = desk_sys::net::Request {
        url: url.to_owned(),
        allowed_hosts: https_host(url).into_iter().collect(),
        timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    };
    let response = desk_sys::net::fetch(&request).map_err(|e| e.message)?;
    match response.status {
        200..=299 => Ok(response.body),
        status => Err(format!("{url} answered {status}")),
    }
}
