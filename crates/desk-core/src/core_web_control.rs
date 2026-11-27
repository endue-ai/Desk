//! `web.read` and `web.act` (ADR 0272): what a view's page says and what is done in it, for the
//! view's caller under `web:control`. `web:browse` shows a page without letting its plugin see
//! it; a page may hold what the person is signed in to, so reading it and acting in it is a
//! grant of its own, whose hosts, when it has any, must cover the page the view shows now. The
//! shell does the work in the page (`WebViews::read`, `WebViews::act`) and is told the address
//! the core allowed the call at: a page that went to another origin meanwhile is left alone.

use desk_bridge::{
    ErrorCode, Permission, RunState, WebActParams, WebActResult, WebAction, WebControlPermission,
    WebKeyName, WebReadParams, WebStep,
};

use crate::account_client::origin_of;
use crate::agent_runs::RUNS;
use crate::approvals::{Action, in_task};
use crate::core_cmd::AgentInvocation;
use crate::core_web::failed;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How many characters `web.read` answers when the call names no `max`.
pub const WEB_READ_CHARS: u64 = 20_000;

/// The target of a call on a page at `at`: its address, or none before the view's first page.
fn target(at: &str) -> Target<'_> {
    if at.is_empty() {
        Target::None
    } else {
        Target::Url(at)
    }
}

pub(crate) fn navigation_key(key: WebKeyName) -> bool {
    use WebKeyName::*;
    matches!(
        key,
        Tab | Escape
            | ArrowUp
            | ArrowDown
            | ArrowLeft
            | ArrowRight
            | PageUp
            | PageDown
            | Home
            | End
    )
}

fn reviewed(action: &WebAction) -> bool {
    match action {
        WebAction::WebPress(_) => true,
        WebAction::WebType(typed) => typed.submit == Some(true),
        WebAction::WebKey(key) => !navigation_key(key.key),
        _ => false,
    }
}

impl Core {
    pub(crate) fn web_read(&self, caller: &str, params: WebReadParams) -> Answer {
        let (views, at) = self.web_page(caller, &params.view_id)?;
        let scope = Permission::WebControl(params.scope);
        self.check(caller, &scope, &target(&at))?;
        let (from, max) = (
            params.from.unwrap_or(0),
            params.max.unwrap_or(WEB_READ_CHARS),
        );
        let page = views.read(&params.view_id, &at, from, max);
        json(page.map_err(failed)?)
    }

    pub(crate) fn web_act(&self, caller: &str, params: WebActParams) -> Answer {
        let (views, at) = self.web_page(caller, &params.view_id)?;
        let scope = Permission::WebControl(params.scope);
        self.check(caller, &scope, &target(&at))?;
        let agent = params
            .invocation_id
            .as_deref()
            .map(|invocation| {
                self.claim_browser_act(caller, invocation, &params.action)
                    .map(|agent| (invocation, agent))
            })
            .transpose()?;
        if let WebAction::WebHistory(history) = &params.action {
            let step = history.to;
            if step == WebStep::Stop {
                views.go(&params.view_id, step).map_err(failed)?;
                return json(WebActResult { moved: None });
            }
            let Some(entry) = views
                .history_target(&params.view_id, &at, step)
                .map_err(failed)?
            else {
                return json(WebActResult { moved: None });
            };
            if !self.web_allows(&params.view_id, &entry.url) {
                return Err(error(
                    ErrorCode::InvalidValue,
                    "the Browser may not load that history entry".into(),
                ));
            }
            if entry.has_post_data {
                let Some(review) = agent.as_ref() else {
                    return Err(error(
                        ErrorCode::InvalidParams,
                        "this history step can resend a form and needs a reviewed Browser command"
                            .into(),
                    ));
                };
                let summary =
                    serde_json::json!({ "to": step, "url": entry.url, "mayResendForm": true });
                self.approve_web_act(
                    caller,
                    review,
                    &params.view_id,
                    &entry.url,
                    &summary.to_string(),
                    true,
                )?;
                self.check(caller, &scope, &target(&at))?;
            }
            views
                .go_history(&params.view_id, &at, step, &entry)
                .map_err(failed)?;
            return json(WebActResult { moved: None });
        }
        if let Some(review) = agent.as_ref()
            && reviewed(&params.action)
        {
            let summary = serde_json::to_string(&params.action).unwrap_or_default();
            self.approve_web_act(caller, review, &params.view_id, &at, &summary, false)?;
            if self.web_page(caller, &params.view_id)?.1 != at {
                return Err(error(
                    ErrorCode::Cancelled,
                    "the page changed while awaiting approval".to_owned(),
                ));
            }
            self.check(caller, &scope, &target(&at))?;
        }
        let done = views.act(&params.view_id, &at, &params.action);
        json(done.map_err(failed)?)
    }

    fn approve_web_act(
        &self,
        provider: &str,
        (invocation, agent): &(&str, AgentInvocation),
        view: &str,
        at: &str,
        summary: &str,
        once: bool,
    ) -> Result<(), desk_bridge::BridgeError> {
        let scope = Permission::WebControl(WebControlPermission {
            permission: Default::default(),
            hosts: desk_sys::net::exact_host(at).map(|host| vec![host]),
        });
        let site = origin_of(at).unwrap_or_default();
        let action = Action::Web {
            view,
            site: &site,
            summary,
            once,
        };
        let hold = || {
            self.check_approval_scope(&agent.caller, &scope, &target(at))?;
            self.held_as(Some(&agent.run), || {
                self.hold(&agent.caller, &scope, action)
            })
        };
        let result = match &agent.turn {
            Some(turn) => in_task(turn, hold).0,
            None => hold(),
        };
        self.cmd_agent(provider, invocation, None)?;
        self.change_run(RUNS, &agent.run, |item| {
            item.state = RunState::Running;
            item.approval = None;
        });
        result.map_err(|e| error(ErrorCode::Cancelled, e.message))
    }
}
