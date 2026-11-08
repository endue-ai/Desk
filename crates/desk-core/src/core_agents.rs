//! agents.* (ADR 0110): the agent programs on this computer, served from the `LocalAgents` the app
//! hands the core. Every call checks `agents:manage`; without local agents it answers
//! `unsupported`. agents.import tells the holders of `agents:manage` with `agents.changed`, and a
//! run of agents.ask reports its steps to them and to its caller as `agents.run`.

use std::path::PathBuf;
use std::sync::Arc;

use desk_bridge::{
    AgentsAskParams, AgentsAskResult, AgentsChangedData, AgentsChangedEvent, AgentsImportParams,
    AgentsImportResult, AgentsListResult, AgentsManagePermission, AgentsParams, AgentsRunsParams,
    AgentsRunsResult, AgentsSessionsParams, AgentsSessionsResult, AgentsStopParams,
    AgentsStopResult, AgentsTranscriptParams, AgentsTranscriptResult, BridgeError, BridgeEvent,
    ErrorCode, LocalAgentAccess, LocalAgentId, LocalAgentSource, Permission,
};

use crate::handler::{Answer, Core, error, json};
use crate::local_agents::{AskPlan, Found, LocalAgents, TURNS_MAX, agent_name, program_for};
use crate::perm::Target;
use crate::sync::lock;
use crate::time::rfc3339_now;

/// How many sessions an import takes without ids.
const IMPORT_MAX: usize = 500;

impl Core {
    /// Serve agents.* from `agents`.
    pub fn with_local_agents(mut self, agents: crate::local_agents::LocalAgents) -> Self {
        self.local_agents = Some(Arc::new(agents));
        self
    }

    fn agents_for(
        &self,
        caller: &str,
        scope: AgentsManagePermission,
    ) -> Result<&Arc<LocalAgents>, BridgeError> {
        self.check(caller, &Permission::AgentsManage(scope), &Target::None)?;
        self.local_agents.as_ref().ok_or_else(|| {
            let message =
                "agents.* is not served: this desk looks for no agent programs".to_owned();
            error(ErrorCode::Unsupported, message)
        })
    }

    /// `agent` when it is found on this computer, else not_found.
    fn found_agent(agents: &LocalAgents, agent: LocalAgentId) -> Result<(), BridgeError> {
        let there = agents.home_of(agent).is_dir() || program_for(agents, agent).is_some();
        if there {
            return Ok(());
        }
        let name = agent_name(agent);
        Err(error(
            ErrorCode::NotFound,
            format!("{name} is not on this computer"),
        ))
    }

    pub(crate) fn agents_list(&self, caller: &str, params: AgentsParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        json(AgentsListResult {
            agents: agents.list(),
        })
    }

    pub(crate) fn agents_sessions(&self, caller: &str, params: AgentsSessionsParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        let from = params.from.unwrap_or(LocalAgentSource::Local);
        if from != LocalAgentSource::Desk {
            Self::found_agent(agents, params.agent)?;
        }
        let query = params.query.unwrap_or_default().to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        let matching: Vec<_> = agents
            .sessions(params.agent, from)
            .into_iter()
            .map(|f| f.session)
            .filter(|s| {
                let text = [Some(&s.title), s.cwd.as_ref(), s.branch.as_ref()]
                    .into_iter()
                    .flatten()
                    .map(|t| t.to_lowercase())
                    .collect::<Vec<_>>()
                    .join(" ");
                words.iter().all(|w| text.contains(w))
            })
            .collect();
        let total = matching.len() as u64;
        let offset = usize::try_from(params.offset.unwrap_or(0)).unwrap_or(usize::MAX);
        let limit = usize::try_from(params.limit.unwrap_or(50).clamp(1, 200)).unwrap_or(50);
        let sessions = matching.into_iter().skip(offset).take(limit).collect();
        json(AgentsSessionsResult { sessions, total })
    }

    pub(crate) fn agents_transcript(&self, caller: &str, params: AgentsTranscriptParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        let limit = usize::try_from(params.limit.unwrap_or(200).clamp(1, 1000)).unwrap_or(200);
        let id = params.session_id;
        let on_disk = agents
            .scan(params.agent)
            .into_iter()
            .find(|f| f.session.id == id);
        if let Some(found) = &on_disk
            && let Some((messages, truncated)) = agents.read_turns(params.agent, &found.path, limit)
        {
            return json(AgentsTranscriptResult {
                session: found.session.clone(),
                messages,
                truncated,
            });
        }
        let copy = lock(&agents.imports).copy(params.agent, &id);
        let Some(copy) = copy else {
            let name = agent_name(params.agent);
            return Err(error(
                ErrorCode::NotFound,
                format!("{name} has no session {id}"),
            ));
        };
        let dropped = copy.messages.len().saturating_sub(limit);
        json(AgentsTranscriptResult {
            session: on_disk.map_or(copy.session, |f| f.session),
            messages: copy.messages.into_iter().skip(dropped).collect(),
            truncated: copy.truncated || dropped > 0,
        })
    }

    pub(crate) fn agents_import(&self, caller: &str, params: AgentsImportParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        if params.from == Some(LocalAgentSource::Desk) {
            let why = "agents.import copies from local or archive, not from the desk".to_owned();
            return Err(error(ErrorCode::InvalidParams, why));
        }
        Self::found_agent(agents, params.agent)?;
        let agent = params.agent;
        let all = agents.scan(agent);
        let (targets, missing): (Vec<Found>, usize) = match &params.session_ids {
            Some(ids) => {
                let pick: Vec<Found> = all
                    .into_iter()
                    .filter(|f| ids.contains(&f.session.id))
                    .filter(|f| match params.from {
                        Some(LocalAgentSource::Archive) => f.session.archived,
                        Some(LocalAgentSource::Local) => !f.session.archived,
                        _ => true,
                    })
                    .collect();
                let missing = ids.len().saturating_sub(pick.len());
                (pick, missing)
            }
            None => {
                let archived = params.from == Some(LocalAgentSource::Archive);
                let pick = all.into_iter().filter(|f| f.session.archived == archived);
                (pick.take(IMPORT_MAX).collect(), 0)
            }
        };
        let mut result = AgentsImportResult {
            imported: 0,
            unchanged: 0,
            failed: missing as u64,
        };
        for found in &targets {
            if lock(&agents.imports).unchanged(agent, found) {
                result.unchanged += 1;
                continue;
            }
            let Some((messages, truncated)) = agents.read_turns(agent, &found.path, TURNS_MAX)
            else {
                result.failed += 1;
                continue;
            };
            let kept = lock(&agents.imports).keep(agent, found, messages, truncated, rfc3339_now());
            match kept {
                Ok(()) => result.imported += 1,
                Err(_) => result.failed += 1,
            }
        }
        if result.imported > 0 {
            self.agents_changed(agent);
        }
        json(result)
    }

    pub(crate) fn agents_ask(&self, caller: &str, params: AgentsAskParams) -> Answer {
        let agents = self.agents_for(caller, params.scope.clone())?;
        let agent = params.agent;
        Self::found_agent(agents, agent)?;
        let invalid = |why: &str| Err(error(ErrorCode::InvalidParams, why.to_owned()));
        if params.prompt.trim().is_empty() {
            return invalid("agents.ask needs a prompt");
        }
        if params
            .model
            .as_deref()
            .is_some_and(|m| !crate::local_agents::is_value(m))
        {
            return invalid("the model is not a value a program may take");
        }
        if let Some(id) = &params.session_id
            && !crate::local_agents::is_session_id(id)
        {
            return invalid("the session id is not one a program names");
        }
        let Some(program) = program_for(agents, agent) else {
            let name = agent_name(agent);
            let why = format!("{name} has no program on this computer the desk can run");
            return Err(error(ErrorCode::Unsupported, why));
        };
        let cwd = self.ask_folder(agents, agent, &params)?;
        let access = params.access.unwrap_or(LocalAgentAccess::ReadOnly);
        let read_only = access == LocalAgentAccess::ReadOnly;
        let args = crate::local_agents::run_args(
            agent,
            &params.prompt,
            params.session_id.as_deref(),
            params.model.as_deref(),
            read_only,
        );
        let mut to = self.holders(&manage());
        to.push(caller.to_owned());
        let plan = AskPlan {
            agent,
            program,
            args,
            cwd,
            path: crate::local_agents::run_path(agents),
            prompt: params.prompt,
            session_id: params.session_id,
            access,
            caller: caller.to_owned(),
            to,
        };
        let run = crate::local_agents::start_run(&agents.runs, self.events().clone(), plan)
            .map_err(crate::handler::sys_error)?;
        json(AgentsAskResult { run })
    }

    /// Where an ask runs: the folder it names, else the folder of the session it resumes, else home.
    fn ask_folder(
        &self,
        agents: &LocalAgents,
        agent: LocalAgentId,
        params: &AgentsAskParams,
    ) -> Result<PathBuf, BridgeError> {
        let folder = match (&params.cwd, &params.session_id) {
            (Some(path), _) => self.resolve(path)?,
            (None, Some(id)) => {
                let on_disk = agents.scan(agent).into_iter().find(|f| &f.session.id == id);
                let session = on_disk
                    .map(|f| f.session)
                    .or_else(|| lock(&agents.imports).copy(agent, id).map(|c| c.session));
                session
                    .and_then(|s| s.cwd)
                    .map(PathBuf::from)
                    .filter(|p| p.is_dir())
                    .unwrap_or_else(|| self.home().to_path_buf())
            }
            (None, None) => self.home().to_path_buf(),
        };
        if !folder.is_dir() {
            let why = format!("{} is not a folder", folder.display());
            return Err(error(ErrorCode::NotFound, why));
        }
        Ok(folder)
    }

    pub(crate) fn agents_runs(&self, caller: &str, params: AgentsRunsParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        let runs = lock(&agents.runs)
            .all()
            .filter(|r| params.agent.is_none_or(|a| r.agent == a))
            .cloned()
            .collect();
        json(AgentsRunsResult { runs })
    }

    pub(crate) fn agents_stop(&self, caller: &str, params: AgentsStopParams) -> Answer {
        let agents = self.agents_for(caller, params.scope)?;
        let id = params.run_id;
        match crate::local_agents::stop_run(&agents.runs, &id) {
            Some(run) => json(AgentsStopResult { run }),
            None => Err(error(
                ErrorCode::NotFound,
                format!("no run {id} is going on"),
            )),
        }
    }

    fn agents_changed(&self, agent: LocalAgentId) {
        let event = AgentsChangedEvent {
            event: Default::default(),
            data: AgentsChangedData { agent },
        };
        let managers = self.holders(&manage());
        self.events()
            .publish_to(managers, BridgeEvent::AgentsChanged(event));
    }
}

fn manage() -> Permission {
    Permission::AgentsManage(AgentsManagePermission {
        permission: Default::default(),
    })
}
