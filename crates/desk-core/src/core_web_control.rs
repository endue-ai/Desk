//! `web.read` and `web.act` (ADR 0270): what a view's page says and what is done in it, for the
//! view's caller under `web:control`. `web:browse` shows a page without letting its plugin see
//! it; a page may hold what the person is signed in to, so reading it and acting in it is a
//! grant of its own, whose hosts, when it has any, must cover the page the view shows now. The
//! shell does the work in the page (`WebViews::read`, `WebViews::act`) and is told the address
//! the core allowed the call at: a page that went to another origin meanwhile is left alone.

use desk_bridge::{Permission, WebActParams, WebReadParams};

use crate::core_web::failed;
use crate::handler::{Answer, Core, json};
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
        let done = views.act(&params.view_id, &at, &params.action);
        json(done.map_err(failed)?)
    }
}
