#![cfg(target_os = "linux")]

#[path = "../src/linux_bus.rs"]
mod linux_bus;
use linux_bus::{Callback, Guard, Outcome, start};
use std::{
    sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use tokio::sync::oneshot;

fn address() -> Option<String> {
    Some(std::env::var("DBUS_SESSION_BUS_ADDRESS").expect("run under dbus-run-session"))
}
fn identity() -> (String, String) {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let name = format!(
        "org.desk.Probe.p{}.n{}.SingleInstance",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let path = format!("/{}", name.replace('.', "/"));
    (name, path)
}
fn launch(pair: &(String, String), args: Vec<String>, cwd: &str, callback: Callback) -> Outcome {
    start(
        None,
        pair.0.clone(),
        pair.1.clone(),
        args,
        cwd.into(),
        callback,
    )
    .unwrap()
}
fn primary(pair: &(String, String), callback: Callback) -> Guard {
    match launch(pair, vec![], "", callback) {
        Outcome::Primary(guard) => guard,
        _ => panic!("expected primary"),
    }
}
fn forward(pair: &(String, String), args: Vec<String>, cwd: &str) {
    assert!(matches!(
        launch(
            pair,
            args,
            cwd,
            Box::new(|_, _| panic!("secondary served callback"))
        ),
        Outcome::Forwarded
    ));
}

#[test]
fn exact_payload_and_owner_survive_startup_and_repeated_forwarding() {
    let pair = identity();
    let (tx, rx) = mpsc::channel();
    let guard = primary(
        &pair,
        Box::new(move |args, cwd| tx.send((args, cwd)).unwrap()),
    );
    let args = [
        "/opt/Desk",
        "",
        "/자료/space here|$.pdf",
        "--not-reparsed",
        "$(touch nope)",
    ]
    .map(String::from)
    .to_vec();
    for _ in 0..3 {
        forward(&pair, args.clone(), "/작업/with spaces | $");
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap(),
            (args.clone(), "/작업/with spaces | $".into())
        );
        assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    }
    drop(guard);
}

#[test]
fn secondary_only_reports_success_after_callback_completed() {
    let pair = identity();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    let guard = primary(
        &pair,
        Box::new(move |_, _| {
            entered_tx.send(()).unwrap();
            release_rx
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }),
    );
    let (done_tx, done_rx) = mpsc::channel();
    let join = thread::spawn(move || {
        forward(&pair, vec!["delayed".into()], "cwd");
        done_tx.send(()).unwrap();
    });
    entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(matches!(done_rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    release_tx.send(()).unwrap();
    done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    join.join().unwrap();
    drop(guard);
}

#[test]
fn simultaneous_start_has_one_owner_and_one_forward_without_replacement() {
    let pair = identity();
    let barrier = Arc::new(Barrier::new(3));
    let (payload_tx, payload_rx) = mpsc::channel();
    let (result_tx, result_rx) = mpsc::channel();
    let workers = (0..2)
        .map(|index| {
            let pair = pair.clone();
            let barrier = barrier.clone();
            let payload_tx = payload_tx.clone();
            let result_tx = result_tx.clone();
            thread::spawn(move || {
                barrier.wait();
                let result = launch(
                    &pair,
                    vec![index.to_string()],
                    "race",
                    Box::new(move |args, cwd| payload_tx.send((args, cwd)).unwrap()),
                );
                result_tx.send(result).unwrap();
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let results = (0..2)
        .map(|_| result_rx.recv_timeout(Duration::from_secs(5)).unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Outcome::Primary(_)))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Outcome::Forwarded))
            .count(),
        1
    );
    let (args, cwd) = payload_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(args == ["0"] || args == ["1"]);
    assert_eq!(cwd, "race");
    forward(&pair, vec!["third".into()], "still owned");
    assert_eq!(
        payload_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        (vec!["third".into()], "still owned".into())
    );
    for worker in workers {
        worker.join().unwrap();
    }
    drop(results);
}

struct Released(mpsc::Sender<()>);
impl Drop for Released {
    fn drop(&mut self) {
        self.0.send(()).unwrap();
    }
}
#[test]
fn drop_releases_bus_name_and_callback_resources_before_returning() {
    let pair = identity();
    let (tx, rx) = mpsc::channel();
    let released = Released(tx);
    let guard = primary(
        &pair,
        Box::new(move |_, _| {
            let _ = &released;
        }),
    );
    drop(guard);
    rx.try_recv()
        .expect("worker and callback must be gone when guard drop returns");
    drop(primary(&pair, Box::new(|_, _| {})));
}

#[test]
fn start_and_drop_work_inside_an_existing_current_thread_runtime() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let pair = identity();
        let guard = primary(&pair, Box::new(|_, _| {}));
        forward(&pair, vec![], "nested caller");
        drop(guard);
        drop(primary(&pair, Box::new(|_, _| {})));
    });
}

#[test]
fn absent_or_malformed_bus_is_unavailable_but_bad_names_are_errors() {
    let pair = identity();
    for address in [
        "invalid-address",
        "unix:path=/tmp/desk-probe-definitely-missing.sock",
    ] {
        match start(
            Some(address.into()),
            pair.0.clone(),
            pair.1.clone(),
            vec![],
            "".into(),
            Box::new(|_, _| {}),
        ) {
            Ok(Outcome::Unavailable(message)) => assert!(!message.is_empty()),
            _ => panic!("missing bus must report why it is unavailable"),
        }
    }
    assert!(
        start(
            address(),
            "invalid name".into(),
            pair.1.clone(),
            vec![],
            "".into(),
            Box::new(|_, _| {})
        )
        .is_err()
    );
    assert!(
        start(
            address(),
            pair.0,
            "/invalid-path".into(),
            vec![],
            "".into(),
            Box::new(|_, _| {})
        )
        .is_err()
    );
}

struct Reject;
#[zbus::interface(name = "org.SingleInstance.DBus")]
impl Reject {
    fn execute_callback(&self, _argv: Vec<String>, _cwd: String) -> zbus::fdo::Result<()> {
        Err(zbus::fdo::Error::Failed("delivery rejected".into()))
    }
}
#[test]
fn rejected_delivery_is_error_not_success_or_normal_launch() {
    let pair = identity();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = oneshot::channel();
    let owner_pair = pair.clone();
    let worker = thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let connection = zbus::connection::Builder::address(address().as_deref().unwrap())
                .name(owner_pair.0.as_str())
                .replace_existing_names(false)
                .allow_name_replacements(false)
                .serve_at(owner_pair.1.as_str(), Reject)
                .build()
                .await
                .unwrap();
            ready_tx.send(()).unwrap();
            stop_rx.await.unwrap();
            connection.close().await.unwrap();
        });
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let result = start(
        address(),
        pair.0,
        pair.1,
        vec![],
        "".into(),
        Box::new(|_, _| {}),
    );
    assert!(result.err().unwrap().contains("delivery rejected"));
    stop_tx.send(()).unwrap();
    worker.join().unwrap();
}

#[test]
fn subprocess_entry() {
    let Ok(name) = std::env::var("DESK_PROBE_CHILD_NAME") else {
        return;
    };
    let path = std::env::var("DESK_PROBE_CHILD_PATH").unwrap();
    let args = std::env::args().collect();
    let cwd = std::env::current_dir()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(matches!(
        start(address(), name, path, args, cwd, Box::new(|_, _| {})),
        Ok(Outcome::Forwarded)
    ));
    println!("SECONDARY_ACKNOWLEDGED");
}

#[test]
fn separate_process_forwards_real_argv_and_cwd_once() {
    use std::process::Command;
    let pair = identity();
    let (tx, rx) = mpsc::channel();
    let guard = primary(
        &pair,
        Box::new(move |args, cwd| tx.send((args, cwd)).unwrap()),
    );
    let executable = std::env::current_exe().unwrap();
    let marker = "파일|$ spaced.pdf";
    let output = Command::new(&executable)
        .args(["--exact", "subprocess_entry", "--nocapture", marker])
        .env("DESK_PROBE_CHILD_NAME", &pair.0)
        .env("DESK_PROBE_CHILD_PATH", &pair.1)
        .current_dir("/tmp")
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("SECONDARY_ACKNOWLEDGED"));
    let (args, cwd) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        args,
        [
            executable.to_str().unwrap(),
            "--exact",
            "subprocess_entry",
            "--nocapture",
            marker
        ]
    );
    assert_eq!(cwd, "/tmp");
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
    drop(guard);
}

#[test]
fn callback_can_release_its_own_guard_without_joining_itself() {
    let pair = identity();
    let holder = Arc::new(Mutex::new(None::<Guard>));
    let callback_holder = holder.clone();
    let (done_tx, done_rx) = mpsc::channel();
    let (released_tx, released_rx) = mpsc::channel();
    let released = Released(released_tx);
    let guard = primary(
        &pair,
        Box::new(move |_, _| {
            let _ = &released;
            drop(callback_holder.lock().unwrap().take());
            done_tx.send(()).unwrap();
        }),
    );
    *holder.lock().unwrap() = Some(guard);
    // Shutdown may close the socket before its reply; the cleanup itself must complete.
    let _ = start(
        address(),
        pair.0.clone(),
        pair.1.clone(),
        vec![],
        "".into(),
        Box::new(|_, _| {}),
    );
    done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    released_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(primary(&pair, Box::new(|_, _| {})));
}
