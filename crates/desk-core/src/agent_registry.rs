//! The agent registry (ADR 0100): one record for every agent, computed when asked, never stored.
//! `agent.list` names Eris, init.yaml's `agents.<id>`, every agent caller that holds a grant or
//! has a run, the brain directory's agents that have runs, and the agents plugins report runs of
//! (`<plugin>/<id>`). An agent's state comes from its runs: waiting over working over error (its
//! last run failed) over idle. `agent.cancel` stops a run; `agent.report` keeps a plugin's run under
//! its own source. Both list and cancel take `perm:manage`: they show and stop what agents do with
//! their grants. The runs themselves are `agent_runs`.

use std::collections::BTreeMap;

use desk_bridge::{
    AgentCancelParams, AgentCancelResult, AgentCancelledData, AgentCancelledEvent, AgentListParams,
    AgentListResult, AgentRecord, AgentReportParams, AgentReportResult, AgentSource, AgentState,
    BridgeEvent, CommandFailure, CommandFailureCode, ErrorCode, Permission, RunItem, RunState,
};

use crate::agent_runs::{RUNS, Run, key, source};
use crate::agents::{AGENT, agent_of};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// Eris's agent id (ADR 0089).
const ERIS: &str = "eris";

impl Core {
    pub(crate) fn agent_list(&self, caller: &str, params: AgentListParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let mut agents: BTreeMap<String, AgentRecord> = BTreeMap::new();
        add(&mut agents, ERIS, "Eris", AgentSource::Eris);
        for id in self.init().agents.keys() {
            add(&mut agents, id, id, AgentSource::Init);
        }
        let held = self.permissions().list();
        for id in held.iter().filter_map(|h| agent_of(&h.caller)) {
            add(&mut agents, id, id, AgentSource::Caller);
        }
        let runs = self.runs_now();
        for item in runs
            .iter()
            .map(|r| &r.item)
            .filter(|i| i.source.connector == RUNS)
        {
            let source = match item.command {
                Some(_) => AgentSource::Caller,
                None => AgentSource::Directory,
            };
            add(&mut agents, &item.agent, &item.agent, source);
        }
        for (id, (name, brain)) in self.reported_agents() {
            add(&mut agents, &id, &name, AgentSource::Local).brain = brain;
        }
        for agent in agents.values_mut() {
            self.describe_agent(agent, &runs);
        }
        let mut agents: Vec<AgentRecord> = agents.into_values().collect();
        agents.sort_by_key(|a| (a.id != ERIS, a.name.to_lowercase()));
        json(AgentListResult { agents })
    }

    pub(crate) fn agent_cancel(&self, caller: &str, params: AgentCancelParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let connector = params
            .source
            .map_or_else(|| RUNS.to_owned(), |s| s.connector);
        let run = self
            .runs()
            .by_key
            .get(&key(&connector, &params.run_id))
            .cloned();
        let Some(Run { item, invocation }) = run else {
            let missing = format!("no run {} of {connector}", params.run_id);
            return Err(error(ErrorCode::NotFound, missing));
        };
        let cancelled = match item.state {
            RunState::Done | RunState::Failed | RunState::Cancelled => false,
            RunState::Waiting => item
                .approval
                .as_deref()
                .is_some_and(|a| self.deny_approval(a)),
            RunState::Running if connector == RUNS => invocation.is_some_and(|invocation| {
                let failure = CommandFailure {
                    code: CommandFailureCode::Cancelled,
                    message: format!("{caller} stopped it"),
                };
                self.cancel_invocation(&invocation, failure)
            }),
            RunState::Running => {
                let data = AgentCancelledData {
                    run_id: item.id.clone(),
                };
                let event = AgentCancelledEvent {
                    event: Default::default(),
                    data,
                };
                self.events()
                    .publish_to(vec![connector], BridgeEvent::AgentCancelled(event));
                true
            }
        };
        json(AgentCancelResult { cancelled })
    }

    pub(crate) fn agent_report(&self, caller: &str, params: AgentReportParams) -> Answer {
        if caller.starts_with(AGENT) || caller.contains(':') {
            let why = format!("{caller} runs no agents of its own to report");
            return Err(error(ErrorCode::PermissionDenied, why));
        }
        let agent = format!("{caller}/{}", params.agent.id);
        let ended = matches!(
            params.state,
            RunState::Done | RunState::Failed | RunState::Cancelled
        );
        let item = RunItem {
            id: params.id,
            source: source(caller),
            kind: Default::default(),
            title: params.title,
            updated_at: self.now_text(),
            created_at: None,
            deep_link: None,
            body: None,
            raw: None,
            agent: agent.clone(),
            state: params.state,
            started_at: params.started_at,
            ended_at: params.ended_at.or_else(|| ended.then(|| self.now_text())),
            result: params.result,
            command: None,
            approval: None,
        };
        self.remember_reported(&agent, params.agent.name, params.agent.brain);
        self.keep_run(Run {
            item,
            invocation: None,
        });
        json(AgentReportResult::new())
    }

    /// Fill in an agent's caller, grants, tools, state and run count.
    fn describe_agent(&self, agent: &mut AgentRecord, runs: &[Run]) {
        let local = agent.source == AgentSource::Local;
        if !local && agent.source != AgentSource::Directory {
            let caller = format!("{AGENT}{}", agent.id);
            let grants: Vec<Permission> = self
                .permissions()
                .grants(&caller)
                .into_iter()
                .map(|g| g.permission)
                .collect();
            let allow = self.allowlist(&agent.id);
            let tools: Vec<String> = allow
                .iter()
                .chain(grants.iter())
                .filter_map(|p| match p {
                    Permission::CmdInvoke(scope) => Some(scope.ids.clone()),
                    _ => None,
                })
                .flatten()
                .collect();
            agent.grants = (!grants.is_empty()).then_some(grants);
            agent.tools = (!tools.is_empty()).then(|| dedup(tools));
            agent.caller = Some(caller);
        }
        let mine: Vec<&RunItem> = runs
            .iter()
            .map(|r| &r.item)
            .filter(|i| i.agent == agent.id)
            .collect();
        agent.runs = Some(mine.len() as u64);
        agent.state = if mine.iter().any(|i| i.state == RunState::Waiting) {
            AgentState::Waiting
        } else if mine.iter().any(|i| i.state == RunState::Running) {
            AgentState::Working
        } else if mine.last().is_some_and(|i| i.state == RunState::Failed) {
            AgentState::Error
        } else {
            AgentState::Idle
        };
    }
}

/// The agent `id`, added as `source` when the registry has none yet.
fn add<'a>(
    agents: &'a mut BTreeMap<String, AgentRecord>,
    id: &str,
    name: &str,
    source: AgentSource,
) -> &'a mut AgentRecord {
    let entry = agents.entry(id.to_owned());
    entry.or_insert_with(|| record(id, name, source))
}

fn record(id: &str, name: &str, source: AgentSource) -> AgentRecord {
    AgentRecord {
        id: id.to_owned(),
        name: name.to_owned(),
        colour: None,
        source,
        caller: None,
        brain: None,
        tools: None,
        grants: None,
        state: AgentState::Idle,
        runs: None,
    }
}

fn dedup(mut ids: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    ids.retain(|id| seen.insert(id.clone()));
    ids
}
