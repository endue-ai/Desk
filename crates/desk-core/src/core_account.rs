//! account.* (ADR 0084): the desk's endue ID, served from the `Account` the app hands the core.
//! Every call checks `account:manage`; without an account it answers `unsupported`. Signing in
//! opens the page where the person enters the code in the system's browser, and every change goes
//! out as `account.changed` to the holders of `account:manage`.

use std::sync::Arc;

use desk_bridge::{
    AccountChangedEvent, AccountManagePermission, AccountParams, AccountSignIn, AccountState,
    AccountStatus, BridgeError, BridgeEvent, ErrorCode, Permission,
};

use crate::account::{Account, Snapshot, State};
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::time::rfc3339;

impl Core {
    /// Serve account.* from `account`, whose token the brain is given by the app.
    pub fn with_account(mut self, account: Arc<Account>) -> Self {
        self.account = Some(account);
        self
    }

    /// Send the account's changes as `account.changed`. Does nothing without an account.
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
    }

    pub(crate) fn account_status(&self, caller: &str, params: AccountParams) -> Answer {
        let account = self.account_for(caller, params)?;
        json(bridge_status(&account.status()))
    }

    pub(crate) fn account_sign_in(&self, caller: &str, params: AccountParams) -> Answer {
        let account = self.account_for(caller, params)?;
        let snapshot = account
            .sign_in()
            .map_err(|why| error(ErrorCode::IoError, why))?;
        if let State::SigningIn(code) = &snapshot.state {
            let page = code
                .verification_uri_complete
                .as_deref()
                .unwrap_or(&code.verification_uri);
            // The code is in the answer too, so a browser that does not open is not a failure.
            if let Ok(link) = desk_sys::shell::link(page) {
                let _ = self.opener.open_url(&link.url);
            }
        }
        json(bridge_status(&snapshot))
    }

    pub(crate) fn account_sign_out(&self, caller: &str, params: AccountParams) -> Answer {
        let account = self.account_for(caller, params)?;
        json(bridge_status(&account.sign_out()))
    }

    fn account_for(
        &self,
        caller: &str,
        params: AccountParams,
    ) -> Result<&Arc<Account>, BridgeError> {
        self.check(
            caller,
            &Permission::AccountManage(params.scope),
            &Target::None,
        )?;
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
                expires_at: rfc3339(code.expires_at),
            }),
        ),
    };
    AccountStatus {
        state,
        sign_in,
        problem: snapshot.problem.clone(),
    }
}
