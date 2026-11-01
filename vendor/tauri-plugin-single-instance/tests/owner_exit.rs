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
