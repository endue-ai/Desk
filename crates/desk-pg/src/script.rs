//! A script: several statements in one call (ADR 0344), each run as `run_statement` runs one and
//! answered with its own first page and the notices it heard, so a caller crosses to the session's
//! task once for many statements instead of once for each. The server sees what it sees for single
//! statements, one after another, but each statement's Sync goes out with the next statement's
//! messages, so a statement costs one round trip. It stops after a page with `more` (the result or
//! COPY stays open for `fetch` and `copy`), at the first error unless it goes on, at a cancel, and
//! when the call or the connection fails; what ran before stays answered.

use std::sync::atomic::Ordering;

use crate::error::{Error, ServerError};
use crate::page::{Limits, MAX_NOTICES, Page, Transaction};
use crate::session::Statement;
use crate::task::{End, Fail, Open, Reply, Task};

/// What a script answers.
#[derive(Debug, Default)]
pub struct Script {
    /// The first page of each statement that ran, in order.
    pub pages: Vec<Page>,
    /// A cancel came while it ran: no statement after the last page started.
    pub cancelled: bool,
    /// The call's failure that stopped it, which the statement after the last page met.
    pub failure: Option<Error>,
}

/// What a deferred Sync answered: the state after the statement before it, and the notices heard
/// up to it (a deferred trigger's at its commit).
pub(crate) struct Settled {
    transaction: Transaction,
    notices: Vec<ServerError>,
    skipped: u64,
}

impl Task {
    pub(crate) async fn script(
        &mut self,
        statements: Vec<Statement>,
        limits: Limits,
        go_on: bool,
        reply: Reply<Script>,
    ) -> Result<(), End> {
        let mut script = Script::default();
        self.deferring = true;
        let end = self.each(statements, limits, go_on, &mut script).await;
        self.deferring = false;
        // The last statement's Sync is still in the buffer.
        let end = match end {
            None if self.unsynced > 0 => self.last_sync(&mut script).await,
            end => end,
        };
        script.cancelled = end.is_none() && self.shared.cancelled.load(Ordering::SeqCst);
        self.heard = None;
        let _ = reply.send(Ok(script));
        end.map_or(Ok(()), Err)
    }

    async fn each(
        &mut self,
        statements: Vec<Statement>,
        limits: Limits,
        go_on: bool,
        script: &mut Script,
    ) -> Option<End> {
        for statement in statements {
            if self.shared.cancelled.load(Ordering::SeqCst) {
                return None;
            }
            self.heard = Some((Vec::new(), 0));
            let outcome = self.run_statement(statement, limits).await;
            self.apply_settled(&mut script.pages);
            let open = !matches!(self.open, Open::None);
            self.shared.open.store(open, Ordering::SeqCst);
            let page = match outcome {
                Ok(page) => page,
                Err(Fail::Call(error)) => {
                    // Its notices are the session's own, as a failed db.run's are.
                    let _ = self.with_notices(Err(Error::Closed));
                    script.failure = Some(error);
                    return None;
                }
                Err(Fail::End(ended)) => {
                    // The server's FATAL is the statement's answer; any other end is a failure.
                    let fatal = matches!(ended, End::Server).then(|| self.fatal.clone());
                    match fatal.flatten() {
                        Some(error) => script.pages.push(self.noticed(Page {
                            error: Some(error),
                            ..Page::default()
                        })),
                        None => {
                            let _ = self.with_notices(Err(Error::Closed));
                            script.failure = Some(failure(&ended));
                        }
                    }
                    return Some(ended);
                }
            };
            let stop = page.more || (page.error.is_some() && !go_on);
            script.pages.push(self.noticed(page));
            if stop {
                return None;
            }
        }
        None
    }

    /// Send the last statement's Sync and read its answer into that statement's page.
    async fn last_sync(&mut self, script: &mut Script) -> Option<End> {
        self.heard = Some((Vec::new(), 0));
        let settled = match self.send().await {
            Ok(()) => self.settle_deferred().await,
            Err(fail) => Err(fail),
        };
        self.apply_settled(&mut script.pages);
        match settled {
            Ok(()) => None,
            Err(Fail::Call(error)) => {
                script.failure = Some(error);
                None
            }
            Err(Fail::End(ended)) => {
                script.failure = Some(failure(&ended));
                Some(ended)
            }
        }
    }

    /// Read the answers of the Syncs a script left in the buffer (they went out with what was just
    /// sent), keeping the state and the notices they answer for the statement before.
    pub(crate) async fn settle_deferred(&mut self) -> Result<(), Fail> {
        if self.unsynced == 0 {
            return Ok(());
        }
        let own = self.heard.replace((Vec::new(), 0));
        let settled = self.settle().await;
        let (notices, skipped) = std::mem::replace(&mut self.heard, own).unwrap_or_default();
        self.settled = Some(Settled {
            transaction: settled?,
            notices,
            skipped,
        });
        Ok(())
    }

    /// What the last deferred Sync answered goes on the page of the statement it followed.
    fn apply_settled(&mut self, pages: &mut [Page]) {
        let (Some(settled), Some(page)) = (self.settled.take(), pages.last_mut()) else {
            return;
        };
        page.transaction = Some(settled.transaction);
        let room = MAX_NOTICES.saturating_sub(page.notices.len());
        let over = settled.notices.len().saturating_sub(room) as u64;
        page.notices.extend(settled.notices.into_iter().take(room));
        page.notices_skipped += settled.skipped + over;
    }

    /// The page with the notices its statement heard.
    fn noticed(&mut self, page: Page) -> Page {
        self.with_notices(Ok(page)).unwrap_or_default()
    }
}

fn failure(end: &End) -> Error {
    match end {
        End::Io(why) => Error::Io(why.clone()),
        _ => Error::Closed,
    }
}
