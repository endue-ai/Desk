// Linux zbus 6 adapter; upstream protocol and provenance are recorded in NOTICE.
use std::{sync::mpsc, thread};
use tokio::sync::oneshot;
use zbus::{connection::Builder, interface};

pub type Callback = Box<dyn FnMut(Vec<String>, String) + Send + Sync + 'static>;

struct Service(Callback);
#[interface(name = "org.SingleInstance.DBus")]
impl Service {
    fn execute_callback(&mut self, argv: Vec<String>, cwd: String) {
        (self.0)(argv, cwd);
    }
}

pub enum Outcome {
    Primary(Guard),
    Forwarded,
    Unavailable(String),
}

enum Started {
    Primary,
    Forwarded,
    Unavailable(String),
}

pub struct Guard {
    stop: Option<oneshot::Sender<()>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(worker) = self.worker.take() {
            // A callback may call destroy; never join the service thread from itself.
            if worker.thread().id() != thread::current().id() {
                let _ = worker.join();
            }
        }
    }
}

// An explicit address isolates tests; production uses the normal session-bus discovery.
pub fn start(
    address: Option<String>,
    name: String,
    path: String,
    args: Vec<String>,
    cwd: String,
    callback: Callback,
) -> Result<Outcome, String> {
    // Preserve the previous plugin's configuration errors (the v6 builder defers them).
    zbus::names::WellKnownName::try_from(name.as_str()).map_err(|e| e.to_string())?;
    zbus::ObjectPath::try_from(path.as_str()).map_err(|e| e.to_string())?;
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let (stop_tx, stop_rx) = oneshot::channel();
    let worker = thread::Builder::new()
        .name("desk-single-instance".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = ready_tx.send(Err(error.to_string()));
                    return;
                }
            };
            runtime.block_on(async move {
                let builder = || match address.as_deref() {
                    Some(address) => Builder::address(address),
                    None => Builder::session(),
                };
                let connection = builder()
                    .name(name.as_str())
                    .replace_existing_names(false)
                    .allow_name_replacements(false)
                    .serve_at(path.as_str(), Service(callback))
                    .build()
                    .await;
                match connection {
                    Ok(connection) => {
                        let _ = ready_tx.send(Ok(Started::Primary));
                        let _ = stop_rx.await;
                        // Closing breaks references held by the object server and releases ownership.
                        let _ = connection.close().await;
                    }
                    Err(zbus::Error::NameTaken) => {
                        let result = async {
                            let connection = builder().build().await?;
                            let reply = connection
                                .call_method(
                                    Some(name.as_str()),
                                    path.as_str(),
                                    Some("org.SingleInstance.DBus"),
                                    "ExecuteCallback",
                                    &(args, cwd),
                                )
                                .await;
                            let _ = connection.close().await;
                            reply?.body().deserialize::<()>()?;
                            Ok::<_, zbus::Error>(Started::Forwarded)
                        }
                        .await
                        .map_err(|error| {
                            format!("failed to forward arguments to the running instance: {error}")
                        });
                        let _ = ready_tx.send(result);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Ok(Started::Unavailable(error.to_string())));
                    }
                }
            });
        })
        .map_err(|error| error.to_string())?;
    let guard = Guard {
        stop: Some(stop_tx),
        worker: Some(worker),
    };
    match ready_rx.recv().map_err(|error| error.to_string())?? {
        Started::Primary => Ok(Outcome::Primary(guard)),
        Started::Forwarded => Ok(Outcome::Forwarded),
        Started::Unavailable(error) => Ok(Outcome::Unavailable(error)),
    }
}
