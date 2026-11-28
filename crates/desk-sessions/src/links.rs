//! The things a session touched, found in structured fields first and in text second: files and
//! memory notes by path, tickets, pull requests, issues and ADRs by name, branches and repositories.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::LazyLock;

use desk_bridge::{AgentLinkKind, AgentLinkPlace, AgentLinkRel, AgentSessionLink};
use regex::Regex;

/// Links kept per kind, the most frequent first; the schema allows 800 in all.
const CAPS: &[(AgentLinkKind, usize)] = &[
    (AgentLinkKind::File, 300),
    (AgentLinkKind::Memory, 40),
    (AgentLinkKind::Ticket, 150),
    (AgentLinkKind::Pr, 60),
    (AgentLinkKind::Issue, 40),
    (AgentLinkKind::Adr, 60),
    (AgentLinkKind::Branch, 10),
    (AgentLinkKind::Repo, 10),
];
/// Hosts kept for `domains`, the most frequent first.
const DOMAINS: usize = 30;
/// Prefixes of names that look like ticket keys and are not: encodings, standards, hashes.
const NOT_TICKETS: &[&str] = &[
    "ADR", "AES", "ARM", "CVE", "CWE", "ECMA", "ES", "GHSA", "GPT", "HS", "HTTP", "HTTPS", "IEEE",
    "IPV", "ISO", "JSR", "MD", "PEP", "PS", "RFC", "RS", "SHA", "SSL", "TLS", "UTF", "WCAG", "X",
];

static TICKET: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b([A-Z][A-Z0-9]{1,9})-([0-9]{1,6})\b").expect("ticket"));
static PULL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"https?://([A-Za-z0-9.-]+)/([A-Za-z0-9_.~-]+(?:/[A-Za-z0-9_.~-]+)*?)/(?:-/)?",
        r"(pull|pulls|merge_requests|issues)/([0-9]+)"
    ))
    .expect("pull request")
});
static HOST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"https?://([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)").expect("host"));
static ADR_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\bADR[ -]?0*([0-9]{1,4})\b").expect("adr"));
static ADR_FILE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/docs/adr/0*([0-9]{1,4})-[^/]*\.md$").expect("adr file"));
static WORKTREE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/(?:\.claude/worktrees|\.worktrees)/[^/]+").expect("worktree"));

/// Paths as the knowledge base keys them: `~` for `home`, a Claude worktree folded into its repo.
#[derive(Debug, Clone)]
pub struct Paths {
    home: String,
}

impl Paths {
    pub fn new(home: &str) -> Self {
        Self {
            home: home.trim_end_matches('/').to_owned(),
        }
    }

    /// `path` with the home folder as `~`, as the transcript says it.
    pub fn tilde(&self, path: &str) -> String {
        match path.strip_prefix(&self.home) {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("~{rest}"),
            _ => path.to_owned(),
        }
    }

    /// A `~` path back to the full one.
    pub fn untilde(&self, path: &str) -> String {
        match path.strip_prefix('~') {
            Some(rest) if rest.is_empty() || rest.starts_with('/') => {
                format!("{}{rest}", self.home)
            }
            _ => path.to_owned(),
        }
    }

    /// `path` with `~` and a `.claude/worktrees/<name>` or `.worktrees/<name>` folder folded away.
    pub fn fold(&self, path: &str) -> String {
        WORKTREE.replace(&self.tilde(path), "").into_owned()
    }
}

/// Where each mention is strongest: the person's words beat a branch, a command and an answer.
fn rank(place: Option<AgentLinkPlace>) -> u8 {
    match place {
        Some(AgentLinkPlace::Prompt) => 0,
        Some(AgentLinkPlace::Branch) => 1,
        Some(AgentLinkPlace::Tool) => 2,
        Some(AgentLinkPlace::Answer) => 3,
        None => 4,
    }
}

/// One session's links while it is read.
#[derive(Debug, Default)]
pub struct Links {
    found: HashMap<(AgentLinkKind, String, AgentLinkRel), (Option<AgentLinkPlace>, u64)>,
    adrs: HashMap<(u32, AgentLinkRel), (Option<AgentLinkPlace>, u64)>,
    domains: BTreeMap<String, u64>,
}

impl Links {
    pub fn add(
        &mut self,
        kind: AgentLinkKind,
        key: &str,
        rel: AgentLinkRel,
        place: Option<AgentLinkPlace>,
    ) {
        let key = key.trim();
        if key.is_empty() || key.chars().count() > 1000 {
            return;
        }
        let entry = self
            .found
            .entry((kind, key.to_owned(), rel))
            .or_insert((place, 0));
        entry.1 += 1;
        if rank(place) < rank(entry.0) {
            entry.0 = place;
        }
    }

    /// A file a tool changed or read: a memory note, an ADR and a file, by its folded path.
    pub fn path(&mut self, paths: &Paths, path: &str, rel: AgentLinkRel) {
        let key = paths.fold(path);
        if key.contains("/.claude/projects/") && key.contains("/memory/") && key.ends_with(".md") {
            if rel == AgentLinkRel::Edited {
                self.add(AgentLinkKind::Memory, &key, AgentLinkRel::Wrote, None);
            }
            return;
        }
        if let Some(number) = ADR_FILE.captures(&key).and_then(|c| c[1].parse().ok()) {
            self.adr(number, AgentLinkRel::Cites, Some(AgentLinkPlace::Tool));
        }
        self.add(AgentLinkKind::File, &key, rel, None);
    }

    /// Tickets, pull requests, issues, ADRs and URL hosts named in `text`.
    pub fn scan(&mut self, text: &str, place: AgentLinkPlace) {
        for key in ticket_keys(text) {
            self.add(
                AgentLinkKind::Ticket,
                &key,
                AgentLinkRel::Mentioned,
                Some(place),
            );
        }
        for caps in PULL.captures_iter(text) {
            let (kind, key) = pull_key(&caps);
            self.add(kind, &key, AgentLinkRel::Mentioned, Some(place));
        }
        for caps in ADR_NAME.captures_iter(text) {
            if let Ok(number) = caps[1].parse() {
                self.adr(number, AgentLinkRel::Cites, Some(place));
            }
        }
        for caps in HOST.captures_iter(text) {
            let host = caps[1].trim_end_matches('.').to_ascii_lowercase();
            if host.contains('.') || host == "localhost" {
                *self.domains.entry(host).or_default() += 1;
            }
        }
    }

    /// The tickets a branch is named for (`feat/ACME-868-icons`): the session is `on` them. A
    /// separate relation from a mention, so a reader can tell project keys from other names.
    pub fn branch(&mut self, branch: &str) {
        for key in ticket_keys(branch) {
            let place = Some(AgentLinkPlace::Branch);
            self.add(AgentLinkKind::Ticket, &key, AgentLinkRel::On, place);
        }
    }

    /// A pull request the session opened, by its URL.
    pub fn opened(&mut self, url: &str) -> bool {
        let Some(caps) = PULL.captures(url) else {
            return false;
        };
        let (kind, key) = pull_key(&caps);
        self.add(kind, &key, AgentLinkRel::Opened, None);
        true
    }

    fn adr(&mut self, number: u32, rel: AgentLinkRel, place: Option<AgentLinkPlace>) {
        let entry = self.adrs.entry((number, rel)).or_insert((place, 0));
        entry.1 += 1;
        if rank(place) < rank(entry.0) {
            entry.0 = place;
        }
    }

    /// The links, capped per kind, the most frequent first; ADRs named for `repo`.
    pub fn finish(mut self, repo: Option<&str>) -> (Vec<AgentSessionLink>, Vec<String>) {
        let repo = repo.unwrap_or("?");
        for ((number, rel), (place, count)) in std::mem::take(&mut self.adrs) {
            let key = format!("ADR-{number:04}@{repo}");
            let entry = self
                .found
                .entry((AgentLinkKind::Adr, key, rel))
                .or_insert((place, 0));
            entry.1 += count;
        }
        let mut by_kind: HashMap<AgentLinkKind, Vec<AgentSessionLink>> = HashMap::new();
        for ((kind, key, rel), (place, count)) in self.found {
            let link = AgentSessionLink {
                kind,
                key,
                rel,
                r#where: place,
                count,
            };
            by_kind.entry(kind).or_default().push(link);
        }
        let mut links = Vec::new();
        for (kind, cap) in CAPS {
            let mut list = by_kind.remove(kind).unwrap_or_default();
            list.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.key.cmp(&b.key)));
            list.truncate(*cap);
            links.extend(list);
        }
        let mut domains: Vec<(String, u64)> = self.domains.into_iter().collect();
        domains.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let domains: BTreeSet<String> = domains.into_iter().take(DOMAINS).map(|d| d.0).collect();
        (links, domains.into_iter().collect())
    }
}

/// The ticket-like keys in `text`: a prefix of two letters or more (`ACME-868`, `RQ-09`), not one of
/// `NOT_TICKETS`, and not the tail of a longer dashed name (`A-Z0-9` is a character class).
fn ticket_keys(text: &str) -> impl Iterator<Item = String> + '_ {
    TICKET.captures_iter(text).filter_map(move |caps| {
        let whole = caps.get(0)?;
        let prefix = &caps[1];
        let letters = prefix.chars().filter(char::is_ascii_uppercase).count();
        let after_dash = text[..whole.start()].ends_with('-');
        (letters >= 2 && !after_dash && !NOT_TICKETS.contains(&prefix))
            .then(|| format!("{prefix}-{}", &caps[2]))
    })
}

/// `host/path#number` and whether it is a pull request or an issue.
fn pull_key(caps: &regex::Captures<'_>) -> (AgentLinkKind, String) {
    let kind = if &caps[3] == "issues" {
        AgentLinkKind::Issue
    } else {
        AgentLinkKind::Pr
    };
    let host = caps[1].to_ascii_lowercase();
    (kind, format!("{host}/{}#{}", &caps[2], &caps[4]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(links: &[AgentSessionLink]) -> Vec<String> {
        links.iter().map(|l| l.key.clone()).collect()
    }

    #[test]
    fn worktrees_fold_into_their_repo() {
        let paths = Paths::new("/Users/me/");
        let path = "/Users/me/desk/.claude/worktrees/ai-12/plugins/a.js";
        assert_eq!(paths.fold(path), "~/desk/plugins/a.js");
        let own = "/Users/me/desk/.worktrees/ACME-1163/src/b.ts";
        assert_eq!(paths.fold(own), "~/desk/src/b.ts");
        assert_eq!(paths.fold("/Users/meow/x"), "/Users/meow/x");
    }

    #[test]
    fn text_names_tickets_pulls_and_adrs() {
        let mut links = Links::default();
        let text = "ACME-868 and UTF-8 and [A-Z0-9-] and X1-2, see https://github.com/acme/desk/pull/459 and \
                    https://git.example.com/g/sub/repo/-/merge_requests/12 per ADR 0088";
        links.scan(text, AgentLinkPlace::Prompt);
        let (found, domains) = links.finish(Some("~/desk"));
        assert_eq!(
            keys(&found),
            [
                "ACME-868",
                "git.example.com/g/sub/repo#12",
                "github.com/acme/desk#459",
                "ADR-0088@~/desk"
            ]
        );
        assert_eq!(domains, ["git.example.com", "github.com"]);
    }

    #[test]
    fn the_strongest_place_wins() {
        let mut links = Links::default();
        links.scan("ACME-1", AgentLinkPlace::Answer);
        links.scan("ACME-1", AgentLinkPlace::Prompt);
        let (found, _) = links.finish(None);
        assert_eq!(found[0].r#where, Some(AgentLinkPlace::Prompt));
        assert_eq!(found[0].count, 2);
    }

    #[test]
    fn memory_notes_and_adr_files_are_their_own_kinds() {
        let paths = Paths::new("/Users/me");
        let mut links = Links::default();
        let note = "/Users/me/.claude/projects/-Users-me-desk/memory/git.md";
        links.path(&paths, note, AgentLinkRel::Edited);
        links.path(
            &paths,
            "/Users/me/desk/docs/adr/0092-x.md",
            AgentLinkRel::Read,
        );
        let (found, _) = links.finish(Some("~/desk"));
        let kinds: Vec<AgentLinkKind> = found.iter().map(|l| l.kind).collect();
        assert_eq!(
            kinds,
            [
                AgentLinkKind::File,
                AgentLinkKind::Memory,
                AgentLinkKind::Adr
            ]
        );
    }
}
