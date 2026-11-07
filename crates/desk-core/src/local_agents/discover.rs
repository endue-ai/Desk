//! Finding the agent programs: an agent is there when its data folder or its program is. The program
//! is looked for on the PATH the desk started with and in the folders installers put programs in,
//! because a desk opened from the Finder starts without the shell's PATH. Nothing is run: the version
//! is the one the newest session recorded.

use std::path::{Path, PathBuf};

use desk_bridge::{LocalAgent, LocalAgentId, LocalAgentRunState, LocalAgentSource};

use super::{LocalAgents, agent_name};

/// The agents the core knows, Claude Code first.
pub(crate) const KNOWN: [LocalAgentId; 2] = [LocalAgentId::Claude, LocalAgentId::Codex];

/// The program's name and who makes it.
pub(crate) fn about(agent: LocalAgentId) -> (&'static str, &'static str) {
    match agent {
        LocalAgentId::Claude => ("Claude Code", "Anthropic"),
        LocalAgentId::Codex => ("Codex", "OpenAI"),
    }
}

/// The folders installers put agent programs in, besides the PATH: the user's own bin folders, the
/// package managers' and the newest Node under nvm.
pub(crate) fn install_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [
        ".local/bin",
        ".claude/local",
        ".npm-global/bin",
        ".bun/bin",
        ".volta/bin",
    ]
    .iter()
    .map(|d| home.join(d))
    .collect();
    if !cfg!(windows) {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
    }
    let nvm = home.join(".nvm/versions/node");
    let mut nodes: Vec<PathBuf> = std::fs::read_dir(&nvm)
        .map(|e| e.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    nodes.sort_by_key(|p| version_key(p));
    if let Some(newest) = nodes.last() {
        dirs.push(newest.join("bin"));
    }
    dirs
}

/// `v20.11.1` as numbers, so v20 sorts after v9.
fn version_key(path: &Path) -> Vec<u64> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    name.trim_start_matches('v')
        .split('.')
        .map(|n| n.parse().unwrap_or(0))
        .collect()
}

/// The folders a program is looked for in, in order: the extra folders, then the PATH.
pub(crate) fn search_path(agents: &LocalAgents) -> Vec<PathBuf> {
    let mut dirs = agents.options.extra_path.clone();
    if let Some(path) = &agents.options.path {
        dirs.extend(std::env::split_paths(path));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    dirs
}

/// Where the agent's program is, when it is somewhere the desk looks.
pub(crate) fn program_for(agents: &LocalAgents, agent: LocalAgentId) -> Option<PathBuf> {
    let name = agent_name(agent);
    search_path(agents)
        .into_iter()
        .flat_map(|dir| candidates(&dir, name))
        .find(|p| runnable(p))
}

fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|ext| dir.join(format!("{name}.{ext}")))
            .collect()
    } else {
        vec![dir.join(name)]
    }
}

#[cfg(unix)]
fn runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn runnable(path: &Path) -> bool {
    path.is_file()
}

impl LocalAgents {
    /// The agents found, with their counts.
    pub(crate) fn list(&self) -> Vec<LocalAgent> {
        KNOWN
            .iter()
            .filter_map(|&agent| self.found(agent))
            .collect()
    }

    /// One agent as found, or None when neither its data folder nor its program is there.
    pub(crate) fn found(&self, agent: LocalAgentId) -> Option<LocalAgent> {
        let home = self.home_of(agent);
        let program = program_for(self, agent);
        if program.is_none() && !home.is_dir() {
            return None;
        }
        let sessions = self.scan(agent);
        let archived = sessions.iter().filter(|f| f.session.archived).count();
        let version = sessions.iter().find_map(|f| f.session.version.clone());
        let imported = crate::sync::lock(&self.imports).count(agent);
        let running = crate::sync::lock(&self.runs)
            .all()
            .filter(|r| r.agent == agent && r.state == LocalAgentRunState::Running)
            .count();
        let (name, vendor) = about(agent);
        let path = |p: &Path| p.display().to_string();
        Some(LocalAgent {
            id: agent,
            name: name.to_owned(),
            vendor: vendor.to_owned(),
            program: program.as_deref().map(path),
            version,
            home: home.is_dir().then(|| path(home)),
            sessions: (sessions.len() - archived) as u64,
            archived: archived as u64,
            imported: imported as u64,
            running: running as u64,
        })
    }

    /// The sessions of one source, the newest first.
    pub(crate) fn sessions(
        &self,
        agent: LocalAgentId,
        from: LocalAgentSource,
    ) -> Vec<super::Found> {
        match from {
            LocalAgentSource::Desk => crate::sync::lock(&self.imports).found(agent),
            LocalAgentSource::Local => self
                .scan(agent)
                .into_iter()
                .filter(|f| !f.session.archived)
                .collect(),
            LocalAgentSource::Archive => self
                .scan(agent)
                .into_iter()
                .filter(|f| f.session.archived)
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_newest_node_comes_last() {
        let mut nodes = [
            PathBuf::from("v9.1.0"),
            PathBuf::from("v20.11.1"),
            PathBuf::from("v18.0.0"),
        ];
        nodes.sort_by_key(|p| version_key(p));
        assert_eq!(nodes.last().unwrap(), Path::new("v20.11.1"));
    }
}
