//! COPY through the session. `COPY ... TO STDOUT` answers pages whose data holds the bytes, read on
//! with `fetch`; `COPY ... FROM STDIN` takes chunks of 1 MiB at most until `done` (CopyDone) or
//! `fail` (CopyFail), and a server error that comes while data still goes ends it early.

use std::time::Duration;

use bytes::Bytes;
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend::{self, CopyData};

use crate::COPY_CHUNK;
use crate::error::{Error, ServerError};
use crate::page::{Limits, Page};
use crate::session::CopyInput;
use crate::task::{Fail, Open, Task, unexpected};

impl Task {
    /// The next page of a COPY out: the held message, then messages until the page is full and
    /// one more, which is held; the last page has the tag.
    pub(crate) async fn copy_out(&mut self, limits: Limits) -> Result<Page, Fail> {
        let mut data = match &mut self.open {
            Open::CopyOut { held } => held.take().unwrap_or_default(),
            _ => Vec::new(),
        };
        loop {
            let message = self.next().await?;
            if std::mem::take(&mut self.too_large) {
                self.open = Open::CopyOut { held: None };
                self.close_result().await?;
                let why = "a COPY row is over the limit: the COPY ended".to_owned();
                return Err(Fail::Call(Error::TooLarge(why)));
            }
            match message {
                Message::CopyData(body) => {
                    if !data.is_empty() && data.len() >= limits.bytes {
                        self.open = Open::CopyOut {
                            held: Some(body.data().to_vec()),
                        };
                        return Ok(page_of(data, true));
                    }
                    data.extend_from_slice(body.data());
                }
                Message::CopyDone => {}
                Message::CommandComplete(body) => {
                    let tag = body.tag().map_err(Error::from)?.to_owned();
                    return self.done(page_of(data, false), tag).await;
                }
                Message::ErrorResponse(body) => {
                    let error = ServerError::read(body.fields());
                    return self.failed(page_of(data, false), error).await;
                }
                other => return Err(unexpected(&other, "COPY out")),
            }
        }
    }

    /// A chunk of a COPY in, and its end: `done`, or `fail` with a message.
    pub(crate) async fn copy(&mut self, input: CopyInput) -> Result<Page, Fail> {
        let Open::CopyIn = self.open else {
            let why = "no COPY FROM STDIN waits for data".to_owned();
            return Err(Fail::Call(Error::Invalid(why)));
        };
        if let Some(data) = input.data {
            if data.len() > COPY_CHUNK {
                let why = format!("a chunk is {COPY_CHUNK} bytes at most");
                return Err(Fail::Call(Error::Invalid(why)));
            }
            CopyData::new(Bytes::from(data))
                .map_err(Error::from)?
                .write(&mut self.conn.out);
        }
        if let Some(why) = input.fail {
            frontend::copy_fail(&why, &mut self.conn.out)
                .map_err(|e| Fail::Call(Error::Invalid(e.to_string())))?;
            return self.copy_end().await;
        }
        if input.done {
            frontend::copy_done(&mut self.conn.out);
            return self.copy_end().await;
        }
        frontend::flush(&mut self.conn.out);
        self.send().await?;
        // An error the server sent while data still goes (a bad row) ends the COPY now.
        match tokio::time::timeout(Duration::ZERO, self.next()).await {
            Err(_) => Ok(Page {
                more: true,
                ..Page::default()
            }),
            Ok(Err(fail)) => Err(fail),
            Ok(Ok(Message::ErrorResponse(body))) => {
                let error = ServerError::read(body.fields());
                self.failed(Page::default(), error).await
            }
            Ok(Ok(other)) => Err(unexpected(&other, "COPY in")),
        }
    }

    /// Sync after CopyDone or CopyFail; the statement's tag or error, then ReadyForQuery.
    async fn copy_end(&mut self) -> Result<Page, Fail> {
        self.open = Open::None;
        frontend::sync(&mut self.conn.out);
        self.send().await?;
        let mut page = Page::default();
        loop {
            match self.next().await? {
                Message::CommandComplete(body) => {
                    let tag = body.tag().map_err(Error::from)?.to_owned();
                    page.row_count = crate::page::tag_count(&tag);
                    page.tag = Some(tag);
                }
                Message::ErrorResponse(body) => page.error = Some(ServerError::read(body.fields())),
                Message::ReadyForQuery(body) => {
                    self.shared.set_transaction(body.status());
                    page.transaction = Some(crate::page::Transaction::of(body.status()));
                    return Ok(page);
                }
                _ => {}
            }
        }
    }
}

fn page_of(data: Vec<u8>, more: bool) -> Page {
    Page {
        data: Some(data),
        more,
        ..Page::default()
    }
}
