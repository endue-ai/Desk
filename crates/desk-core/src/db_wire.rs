//! What `desk-pg` answers, as the bridge says it (`specs/bridge/v0/db.schema.json`): pages, the
//! server's errors and notices with every field by name, a session's events for its caller, and the
//! client certificate `db.open` hands over (ADR 0331).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, Weak};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeEvent, DbAuth, DbClosedData, DbClosedEvent, DbClosedReason, DbColumn,
    DbCopy, DbCopyDirection, DbCopyFormat, DbKeyPassword, DbNoticeData, DbNoticeEvent,
    DbNotificationData, DbNotificationEvent, DbOpenResult, DbPage, DbParameterData,
    DbParameterEvent, DbServerError, DbTls, DbTlsInfo, DbTlsMode, DbTransaction, Encoding,
    ErrorCode,
};
use desk_pg::{
    Auth, ClientCert, CloseReason, Direction, Event, KeyError, Page, ServerError, Sink, TlsInfo,
    TlsMode,
};

use crate::core_db::{Databases, forget};
use crate::events::EventBus;
use crate::handler::error;

pub(crate) fn page(page: Page) -> DbPage {
    let (data, encoding) = match page.data {
        Some(bytes) => match String::from_utf8(bytes) {
            Ok(text) => (Some(text), Some(Encoding::Utf8)),
            Err(e) => {
                let text = base64::engine::general_purpose::STANDARD.encode(e.into_bytes());
                (Some(text), Some(Encoding::Base64))
            }
        },
        None => (None, None),
    };
    DbPage {
        columns: page.columns.map(|columns| {
            let column = |c: desk_pg::Column| DbColumn {
                name: c.name,
                type_oid: c.type_oid.into(),
                type_modifier: c.type_modifier.into(),
                type_size: c.type_size.into(),
                table_oid: c.table_oid.into(),
                column_number: c.column_number.into(),
            };
            columns.into_iter().map(column).collect()
        }),
        rows: page.rows,
        more: page.more,
        tag: page.tag,
        row_count: page.row_count,
        transaction: page.transaction.map(transaction),
        error: page.error.as_ref().map(server_error),
        copy: page.copy.map(|copy| DbCopy {
            direction: match copy.direction {
                Direction::In => DbCopyDirection::In,
                Direction::Out => DbCopyDirection::Out,
            },
            format: match copy.binary {
                true => DbCopyFormat::Binary,
                false => DbCopyFormat::Text,
            },
            columns: copy.columns as u64,
        }),
        data,
        encoding,
        notices: (!page.notices.is_empty())
            .then(|| page.notices.iter().map(server_error).collect()),
        notices_skipped: (page.notices_skipped > 0).then_some(page.notices_skipped),
    }
}

/// Every field the server sent, by its name; one the bridge has no name for goes in `other`.
pub(crate) fn server_error(error: &ServerError) -> DbServerError {
    let text = |code: u8| error.field(code).map(str::to_owned);
    let position = |code: u8| error.field(code).and_then(|p| p.parse().ok());
    let named = b"SVCMDHPpqWstcdnFLR";
    let other: BTreeMap<String, String> = (error.fields.iter())
        .filter(|(code, _)| !named.contains(code))
        .map(|(code, value)| ((*code as char).to_string(), value.clone()))
        .collect();
    DbServerError {
        severity: error.severity().to_owned(),
        local_severity: text(b'S').unwrap_or_else(|| error.severity().to_owned()),
        code: error.code().to_owned(),
        message: error.message().to_owned(),
        detail: text(b'D'),
        hint: text(b'H'),
        position: position(b'P'),
        internal_position: position(b'p'),
        internal_query: text(b'q'),
        r#where: text(b'W'),
        schema: text(b's'),
        table: text(b't'),
        column: text(b'c'),
        data_type: text(b'd'),
        constraint: text(b'n'),
        file: text(b'F'),
        line: text(b'L'),
        routine: text(b'R'),
        other: (!other.is_empty()).then_some(other),
    }
}

pub(crate) fn transaction(state: desk_pg::Transaction) -> DbTransaction {
    match state {
        desk_pg::Transaction::Idle => DbTransaction::Idle,
        desk_pg::Transaction::Open => DbTransaction::Open,
        desk_pg::Transaction::Failed => DbTransaction::Failed,
    }
}

pub(crate) fn auth(auth: Auth) -> DbAuth {
    match auth {
        Auth::ScramSha256Plus => DbAuth::ScramSha256Plus,
        Auth::ScramSha256 => DbAuth::ScramSha256,
        Auth::Md5 => DbAuth::Md5,
        Auth::Password => DbAuth::Password,
        Auth::None => DbAuth::None,
    }
}

pub(crate) fn tls_info(tls: &TlsInfo) -> DbTlsInfo {
    DbTlsInfo {
        version: tls.version.clone(),
        cipher: tls.cipher.clone(),
    }
}

pub(crate) fn tls_mode(mode: DbTlsMode) -> TlsMode {
    match mode {
        DbTlsMode::Disable => TlsMode::Disable,
        DbTlsMode::Prefer => TlsMode::Prefer,
        DbTlsMode::Require => TlsMode::Require,
        DbTlsMode::VerifyCa => TlsMode::VerifyCa,
        DbTlsMode::VerifyFull => TlsMode::VerifyFull,
    }
}

fn reason(reason: CloseReason) -> DbClosedReason {
    match reason {
        CloseReason::Closed => DbClosedReason::Closed,
        CloseReason::Server => DbClosedReason::Server,
        CloseReason::Io => DbClosedReason::Io,
        CloseReason::Encoding => DbClosedReason::Encoding,
        CloseReason::Unloaded => DbClosedReason::Unloaded,
        CloseReason::Revoked => DbClosedReason::Revoked,
        CloseReason::Desk => DbClosedReason::Desk,
    }
}

/// Where session `id`'s events go: to `caller` alone, `db.closed` once the entry has left the table.
pub(crate) fn event(
    id: String,
    caller: String,
    events: EventBus,
    databases: Weak<Mutex<Databases>>,
) -> Sink {
    Arc::new(move |happened| {
        let session_id = id.clone();
        let event = match happened {
            Event::Notice(notice) => BridgeEvent::DbNotice(DbNoticeEvent {
                event: Default::default(),
                data: DbNoticeData {
                    session_id,
                    notice: server_error(&notice),
                },
            }),
            Event::Notification {
                pid,
                channel,
                payload,
            } => BridgeEvent::DbNotification(DbNotificationEvent {
                event: Default::default(),
                data: DbNotificationData {
                    session_id,
                    pid: pid.into(),
                    channel,
                    payload,
                },
            }),
            Event::Parameter { name, value } => BridgeEvent::DbParameter(DbParameterEvent {
                event: Default::default(),
                data: DbParameterData {
                    session_id,
                    name,
                    value,
                },
            }),
            Event::Closed {
                reason: why,
                message,
                error,
            } => {
                forget(&databases, &id);
                BridgeEvent::DbClosed(DbClosedEvent {
                    event: Default::default(),
                    data: DbClosedData {
                        session_id,
                        reason: reason(why),
                        message,
                        error: error.as_ref().map(server_error),
                    },
                })
            }
        };
        events.publish_to(vec![caller.clone()], event);
    })
}

/// db.open's answer before any session: nothing yet.
pub(crate) fn empty_open() -> DbOpenResult {
    DbOpenResult {
        session_id: None,
        pid: None,
        auth: None,
        tls: None,
        parameters: None,
        error: None,
        needs_password: None,
        key_password: None,
    }
}

/// Why a client certificate is not used: an answer (`keyPassword`) or a refusal.
pub(crate) enum KeyCheck {
    Answer(DbKeyPassword),
    Refused(BridgeError),
}

/// The client certificate `tls` names, decoded before anything connects; none for `disable`, which
/// has no TLS to present it on. `cert` and `key` come together; `keyPassword` is used once here.
pub(crate) fn client_cert(tls: Option<&DbTls>) -> Result<Option<ClientCert>, KeyCheck> {
    let Some(tls) = tls.filter(|tls| tls.mode != DbTlsMode::Disable) else {
        return Ok(None);
    };
    let refused = |code, why: String| KeyCheck::Refused(error(code, why));
    let (cert, key) = match (&tls.cert, &tls.key) {
        (None, None) if tls.key_password.is_none() => return Ok(None),
        (Some(cert), Some(key)) => (cert, key),
        _ => {
            let why = "tls.cert and tls.key come together, and keyPassword with them".to_owned();
            return Err(refused(ErrorCode::InvalidParams, why));
        }
    };
    let password = tls.key_password.as_deref();
    match ClientCert::from_pem(cert.as_bytes(), key.as_bytes(), password) {
        Ok(client) => Ok(Some(client)),
        Err(KeyError::NeedsPassword) => Err(KeyCheck::Answer(DbKeyPassword::Needed)),
        Err(KeyError::WrongPassword) => Err(KeyCheck::Answer(DbKeyPassword::Wrong)),
        Err(KeyError::Invalid(why)) => Err(refused(ErrorCode::InvalidValue, why)),
    }
}
