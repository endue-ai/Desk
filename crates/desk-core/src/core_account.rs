//! account.* (ADR 0089, ADR 0111): the desk's endue ID, served from the `Account` the app hands
//! the core. Every call checks `account:manage`; without an account it answers `unsupported`.
//! Signing in opens endue ID's page in the system's browser (again when asked again, with the
//! screen asked for), and every change goes out as `account.changed` to the holders of
//! `account:manage`. The account's keeper starts with the account's events.

use std::sync::Arc;

use desk_bridge::{
    AccountChangedEvent, AccountManagePermission, AccountParams, AccountProblem, AccountProfile,
    AccountScreen, AccountSignIn, AccountSignInParams, AccountState, AccountStatus, BridgeError,
    BridgeEvent, ErrorCode, Permission,
};

use crate::account::{Account, Problem, Screen, Snapshot, State};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::time::rfc3339;

impl Core {
    /// Serve account.* from `account`, whose token the brain is given by the app.
    pub fn with_account(mut self, account: Arc<Account>) -> Self {
        self.account = Some(account);
        self
    }

    /// Send the account's changes as `account.changed` and keep its session renewed. Does nothing
    /// without an account.
    pub fn start_account(self: &Arc<Self>) {
        let Some(account) = &self.account else {
            return;
        };
        let core = Arc::downgrade(self);
        account.listen(move |snapshot| {
            if let Some(core) = core.upgrade() {
                core.account_changed(snapshot);
            }
        });
        account.keep_alive();
    }

    pub(crate) fn account_status(&self, caller: &str, params: AccountParams) -> Answer {
        let account = self.account_for(caller, params.scope)?;
        json(bridge_status(&account.status()))
    }

    pub(crate) fn account_sign_in(&self, caller: &str, params: AccountSignInParams) -> Answer {
        let account = self.account_for(caller, params.scope)?;
        let screen = match params.screen {
            Some(AccountScreen::SignUp) => Screen::SignUp,
            Some(AccountScreen::SignIn) | None => Screen::SignIn,
        };
        let snapshot = account.sign_in(screen);
        // The code is in the answer too, so a browser that does not open is not a failure.
        if let Some(page) = account.page()
            && let Ok(link) = desk_sys::shell::link(&page)
        {
            let _ = self.opener.open_url(&link.url);
        }
        json(bridge_status(&snapshot))
    }

    pub(crate) fn account_sign_out(&self, caller: &str, params: AccountParams) -> Answer {
        let account = self.account_for(caller, params.scope)?;
        json(bridge_status(&account.sign_out()))
    }

    pub(crate) fn account_for(
        &self,
        caller: &str,
        scope: AccountManagePermission,
    ) -> Result<&Arc<Account>, BridgeError> {
        self.check(caller, &Permission::AccountManage(scope), &Target::None)?;
        self.account.as_ref().ok_or_else(|| {
            let message = "account.* is not served: this desk has no endue ID".to_owned();
            error(ErrorCode::Unsupported, message)
        })
    }

    fn account_changed(&self, snapshot: &Snapshot) {
        let managers = self.holders(&Permission::AccountManage(AccountManagePermission {
            permission: Default::default(),
        }));
        let event = AccountChangedEvent {
            event: Default::default(),
            data: bridge_status(snapshot),
        };
        self.events()
            .publish_to(managers, BridgeEvent::AccountChanged(event));
    }
}

/// The bridge's shape of the account: no token in it.
fn bridge_status(snapshot: &Snapshot) -> AccountStatus {
    let (state, sign_in) = match &snapshot.state {
        State::SignedOut => (AccountState::SignedOut, None),
        State::SignedIn => (AccountState::SignedIn, None),
        State::SigningIn(code) => (
            AccountState::SigningIn,
            Some(AccountSignIn {
                user_code: code.user_code.clone(),
                verification_uri: code.verification_uri.clone(),
                verification_uri_complete: code.verification_uri_complete.clone(),
                screen: Some(match code.screen {
                    Screen::SignIn => AccountScreen::SignIn,
                    Screen::SignUp => AccountScreen::SignUp,
                }),
                expires_at: rfc3339(code.expires_at),
            }),
        ),
    };
    let profile = snapshot.profile.as_ref().map(|profile| AccountProfile {
        display_name: profile.display_name.clone(),
        email: profile.email.clone(),
        avatar_url: profile.avatar_url.clone(),
    });
    AccountStatus {
        state,
        sign_in,
        profile,
        problem: snapshot.problem.map(|problem| problem.text().to_owned()),
        reason: snapshot.problem.map(reason_of),
    }
}

fn reason_of(problem: Problem) -> AccountProblem {
    match problem {
        Problem::Offline => AccountProblem::Offline,
        Problem::Denied => AccountProblem::Denied,
        Problem::Expired => AccountProblem::Expired,
        Problem::SlowDown => AccountProblem::SlowDown,
        Problem::Unavailable => AccountProblem::Unavailable,
        Problem::Suspended => AccountProblem::Suspended,
        Problem::Rejected => AccountProblem::Rejected,
        Problem::SessionExpired => AccountProblem::SessionExpired,
        Problem::Failed => AccountProblem::Failed,
    }
}
