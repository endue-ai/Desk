#![cfg(target_os = "linux")]

#[path = "../src/linux_bus.rs"]
mod linux_bus;

use linux_bus::{Outcome, start};
use std::{sync::mpsc, thread, time::Duration};
use tokio::sync::oneshot;

struct Departing(mpsc::Sender<()>);
#[zbus::interface(name = "org.SingleInstance.DBus")]
impl Departing {
    async fn execute_callback(&self, _argv: Vec<String>, _cwd: String) {
        self.0.send(()).unwrap();
        std::future::pending::<()>().await;
    }
}

#[test]
fn owner_disappears_during_delivery_and_new_primary_accepts_later_delivery() {
    let address = std::env::var("DBUS_SESSION_BUS_ADDRESS").expect("run under dbus-run-session");
    let name = format!("org.desk.OwnerExit.p{}.SingleInstance", std::process::id());
    let path = format!("/{}", name.replace('.', "/"));
    let (entered_tx, entered_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    let owner_address = address.clone();
    let owner_name = name.clone();
    let owner_path = path.clone();
    let owner = thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let connection = zbus::connection::Builder::address(owner_address.as_str())
                .name(owner_name.as_str())
                .serve_at(owner_path.as_str(), Departing(entered_tx))
                .build()
                .await
                .unwrap();
            ready_tx.send(()).unwrap();
            stop_rx.await.unwrap();
            connection.close().await.unwrap();
        });
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (delivery_tx, delivery_rx) = mpsc::channel();
    let secondary_address = address.clone();
    let secondary_name = name.clone();
    let secondary_path = path.clone();
    let secondary = thread::spawn(move || {
        start(
            Some(secondary_address),
            secondary_name,
            secondary_path,
            vec!["ambiguous".into()],
            "cwd".into(),
            Box::new(move |args, cwd| delivery_tx.send((args, cwd)).unwrap()),
        )
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    stop_tx.send(()).unwrap();
    owner.join().unwrap();
    let guard = match secondary.join().unwrap() {
        Ok(Outcome::Primary(guard)) => guard,
        Ok(_) => panic!("expected newly elected primary"),
        Err(error) => panic!("owner exit must permit election: {error}"),
    };
    assert!(
        delivery_rx.try_recv().is_err(),
        "ambiguous callback was replayed"
    );
    let result = start(
        Some(address),
        name,
        path,
        vec!["later".into()],
        "next".into(),
        Box::new(|_, _| {}),
    );
    assert!(matches!(result, Ok(Outcome::Forwarded)));
    assert_eq!(
        delivery_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        (vec!["later".into()], "next".into())
    );
    assert!(delivery_rx.try_recv().is_err());
    drop(guard);
}

struct RejectNoReply;
#[zbus::interface(name = "org.SingleInstance.DBus")]
impl RejectNoReply {
    fn execute_callback(&self, _argv: Vec<String>, _cwd: String) -> zbus::fdo::Result<()> {
        Err(zbus::fdo::Error::NoReply("live owner refused".into()))
    }
}

#[test]
fn live_owner_no_reply_remains_an_error() {
    let address = std::env::var("DBUS_SESSION_BUS_ADDRESS").expect("run under dbus-run-session");
    let name = format!(
        "org.desk.LiveNoReply.p{}.SingleInstance",
        std::process::id()
    );
    let path = format!("/{}", name.replace('.', "/"));
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    let owner_address = address.clone();
    let owner_name = name.clone();
    let owner_path = path.clone();
    let owner = thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let connection = zbus::connection::Builder::address(owner_address.as_str())
                .name(owner_name.as_str())
                .serve_at(owner_path.as_str(), RejectNoReply)
                .build()
                .await
                .unwrap();
            ready_tx.send(()).unwrap();
            stop_rx.await.unwrap();
            connection.close().await.unwrap();
        });
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let error = start(
        Some(address),
        name,
        path,
        vec![],
        "".into(),
        Box::new(|_, _| {}),
    )
    .err()
    .expect("live owner's error must not elect a primary");
    assert!(error.contains("live owner refused"), "{error}");
    stop_tx.send(()).unwrap();
    owner.join().unwrap();
}

struct Count(mpsc::Sender<()>);
#[zbus::interface(name = "org.SingleInstance.DBus")]
impl Count {
    fn execute_callback(&self, _argv: Vec<String>, _cwd: String) {
        self.0.send(()).unwrap();
    }
}

#[test]
fn replacement_owner_does_not_receive_an_ambiguous_delivery() {
    let address = std::env::var("DBUS_SESSION_BUS_ADDRESS").expect("run under dbus-run-session");
    let name = format!(
        "org.desk.Replacement.p{}.SingleInstance",
        std::process::id()
    );
    let path = format!("/{}", name.replace('.', "/"));
    let (entered_tx, entered_rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (replace_tx, replace_rx) = oneshot::channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    let (count_tx, count_rx) = mpsc::channel();
    let owner_address = address.clone();
    let owner_name = name.clone();
    let owner_path = path.clone();
    let owner = thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let old = zbus::connection::Builder::address(owner_address.as_str())
                .name(owner_name.as_str())
                .serve_at(owner_path.as_str(), Departing(entered_tx))
                .build()
                .await
                .unwrap();
            ready_tx.send(()).unwrap();
            replace_rx.await.unwrap();
            old.release_name(owner_name.as_str()).await.unwrap();
            let replacement = zbus::connection::Builder::address(owner_address.as_str())
                .name(owner_name.as_str())
                .serve_at(owner_path.as_str(), Count(count_tx))
                .build()
                .await
                .unwrap();
            old.close().await.unwrap();
            stop_rx.await.unwrap();
            replacement.close().await.unwrap();
        });
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let secondary = thread::spawn(move || {
        start(
            Some(address),
            name,
            path,
            vec!["ambiguous".into()],
            "cwd".into(),
            Box::new(|_, _| panic!("unexpected primary")),
        )
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    replace_tx.send(()).unwrap();
    let error = secondary
        .join()
        .unwrap()
        .err()
        .expect("replacement prevents election");
    assert!(error.contains("NoReply"), "{error}");
    assert!(
        count_rx.try_recv().is_err(),
        "ambiguous call reached replacement"
    );
    stop_tx.send(()).unwrap();
    owner.join().unwrap();
}
