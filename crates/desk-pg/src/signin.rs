//! The startup message and the sign-in: SCRAM-SHA-256, SCRAM-SHA-256-PLUS with channel binding
//! whenever TLS is on and the server offers it, md5, the password itself (only over TLS), or none;
//! then the server's parameters and its cancel key. The password is dropped once used.

use fallible_iterator::FallibleIterator;
use postgres_protocol::authentication::md5_hash;
use postgres_protocol::authentication::sasl::{ChannelBinding, ScramSha256};
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend;

use crate::config::Config;
use crate::conn::{Conn, Read};
use crate::error::{Error, ServerError, protocol};
use crate::pgpass;

/// How the session signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Auth {
    ScramSha256Plus,
    ScramSha256,
    Md5,
    Password,
    None,
}

impl Auth {
    pub fn name(self) -> &'static str {
        match self {
            Auth::ScramSha256Plus => "scram-sha-256-plus",
            Auth::ScramSha256 => "scram-sha-256",
            Auth::Md5 => "md5",
            Auth::Password => "password",
            Auth::None => "none",
        }
    }
}

/// What the sign-in learnt: the backend's pid and cancel key, every ParameterStatus, and the
/// notices that came with it.
pub(crate) struct SignedIn {
    pub(crate) pid: i32,
    pub(crate) key: i32,
    pub(crate) auth: Auth,
    pub(crate) parameters: Vec<(String, String)>,
    pub(crate) notices: Vec<ServerError>,
}

pub(crate) async fn sign_in(conn: &mut Conn, config: &Config) -> Result<SignedIn, Error> {
    let startup = config.startup();
    let pairs = startup.iter().map(|(n, v)| (n.as_str(), v.as_str()));
    frontend::startup_message(pairs, &mut conn.out).map_err(|e| Error::Invalid(e.to_string()))?;
    conn.send().await?;
    let mut done = SignedIn {
        pid: 0,
        key: 0,
        auth: authenticate(conn, config).await?,
        parameters: Vec::new(),
        notices: Vec::new(),
    };
    loop {
        match message(conn).await? {
            Message::ParameterStatus(p) => {
                let (name, value) = (p.name().map_err(protocol)?, p.value().map_err(protocol)?);
                done.parameters.push((name.to_owned(), value.to_owned()));
            }
            Message::BackendKeyData(k) => (done.pid, done.key) = (k.process_id(), k.secret_key()),
            Message::NoticeResponse(n) => done.notices.push(ServerError::read(n.fields())),
            Message::ErrorResponse(e) => return Err(Error::Refused(ServerError::read(e.fields()))),
            Message::ReadyForQuery(_) => break,
            _ => return Err(protocol("an unexpected message after the sign-in")),
        }
    }
    let encoding = done.parameters.iter().find(|(n, _)| n == "client_encoding");
    if encoding.is_some_and(|(_, v)| !v.eq_ignore_ascii_case("UTF8")) {
        return Err(Error::Io("the server would not send UTF-8".to_owned()));
    }
    Ok(done)
}

async fn message(conn: &mut Conn) -> Result<Message, Error> {
    match conn.recv().await? {
        Read::Message(message) => Ok(message),
        Read::Skipped(tag) => Err(protocol(format!("a message {} too long", tag as char))),
    }
}

/// The password given, else the password file's, else none.
fn password(config: &Config) -> Option<String> {
    config.password.clone().or_else(|| {
        let file = config.password_file.as_ref()?;
        let (host, port) = (config.host.as_str(), config.port);
        pgpass::lookup(file, host, port, &config.database, &config.user)
    })
}

async fn authenticate(conn: &mut Conn, config: &Config) -> Result<Auth, Error> {
    let mut auth = Auth::None;
    let mut scram: Option<ScramSha256> = None;
    let needed = || password(config).ok_or(Error::NeedsPassword);
    loop {
        match message(conn).await? {
            Message::AuthenticationOk => return Ok(auth),
            Message::AuthenticationCleartextPassword => {
                if conn.tls.is_none() {
                    let why = "the server asks for the password in clear text without TLS";
                    return Err(Error::Io(why.to_owned()));
                }
                auth = Auth::Password;
                frontend::password_message(needed()?.as_bytes(), &mut conn.out)
                    .map_err(protocol)?;
            }
            Message::AuthenticationMd5Password(body) => {
                auth = Auth::Md5;
                let hash = md5_hash(config.user.as_bytes(), needed()?.as_bytes(), body.salt());
                frontend::password_message(hash.as_bytes(), &mut conn.out).map_err(protocol)?;
            }
            Message::AuthenticationSasl(body) => {
                let offered: Vec<String> = body
                    .mechanisms()
                    .map(|m| Ok(m.to_owned()))
                    .collect()
                    .map_err(protocol)?;
                let plus = offered.iter().any(|m| m == "SCRAM-SHA-256-PLUS");
                if !plus && !offered.iter().any(|m| m == "SCRAM-SHA-256") {
                    let why = format!("the server offers {offered:?}, none the session speaks");
                    return Err(Error::Unsupported(why));
                }
                let end_point = conn.tls.as_ref().map(|t| t.end_point.clone());
                let (mechanism, binding) = match end_point {
                    Some(Some(hash)) if plus => (
                        Auth::ScramSha256Plus,
                        ChannelBinding::tls_server_end_point(hash),
                    ),
                    // TLS whose certificate's hash is unknown: no binding, so not `y` either.
                    Some(None) => (Auth::ScramSha256, ChannelBinding::unsupported()),
                    Some(Some(_)) => (Auth::ScramSha256, ChannelBinding::unrequested()),
                    None => (Auth::ScramSha256, ChannelBinding::unsupported()),
                };
                auth = mechanism;
                let name = match mechanism {
                    Auth::ScramSha256Plus => "SCRAM-SHA-256-PLUS",
                    _ => "SCRAM-SHA-256",
                };
                let client = ScramSha256::new(needed()?.as_bytes(), binding);
                frontend::sasl_initial_response(name, client.message(), &mut conn.out)
                    .map_err(protocol)?;
                scram = Some(client);
            }
            Message::AuthenticationSaslContinue(body) => {
                let client = scram
                    .as_mut()
                    .ok_or_else(|| protocol("SASL without a start"))?;
                client
                    .update(body.data())
                    .map_err(|e| Error::Io(format!("SCRAM: {e}")))?;
                frontend::sasl_response(client.message(), &mut conn.out).map_err(protocol)?;
            }
            Message::AuthenticationSaslFinal(body) => {
                let client = scram
                    .as_mut()
                    .ok_or_else(|| protocol("SASL without a start"))?;
                // Checks the server's signature: a server that cannot prove it knows the password
                // is not signed in to.
                client
                    .finish(body.data())
                    .map_err(|e| Error::Io(format!("SCRAM: {e}")))?;
                continue;
            }
            Message::AuthenticationGss
            | Message::AuthenticationGssContinue(_)
            | Message::AuthenticationSspi
            | Message::AuthenticationKerberosV5
            | Message::AuthenticationScmCredential => {
                let why = "the server asks for a sign-in the desk does not speak (GSSAPI, SSPI, Kerberos)";
                return Err(Error::Unsupported(why.to_owned()));
            }
            Message::ErrorResponse(e) => return Err(Error::Refused(ServerError::read(e.fields()))),
            _ => return Err(protocol("an unexpected message during the sign-in")),
        }
        conn.send().await?;
    }
}
