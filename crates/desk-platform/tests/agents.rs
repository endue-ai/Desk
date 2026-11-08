//! The client against the in-process fake platform: paging, creating from scratch and from the
//! catalog, updating, turning off and on, soft deletion, one refresh after a 401, and the error
//! envelope as typed errors. Nothing leaves 127.0.0.1.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_platform::fake::FakePlatform;
use desk_platform::wire::{
    AgentPatch, AgentStatus, Nature, NatureRole, NewAgent, Personality, Profile,
};
use desk_platform::{ErrorKind, Platform, Switch, Tokens};

/// Hands out `current`; a refresh moves to `next` when there is one, and counts itself.
struct FakeTokens {
    current: Mutex<Option<String>>,
    next: Mutex<Option<String>>,
    refreshes: AtomicUsize,
}

impl FakeTokens {
    fn new(current: Option<&str>, next: Option<&str>) -> Arc<Self> {
        Arc::new(Self {
            current: Mutex::new(current.map(str::to_owned)),
            next: Mutex::new(next.map(str::to_owned)),
            refreshes: AtomicUsize::new(0),
        })
    }
}

impl Tokens for FakeTokens {
    fn token(&self) -> Option<String> {
        self.current.lock().unwrap().clone()
    }

    fn refresh(&self, _rejected: &str) -> Option<String> {
        self.refreshes.fetch_add(1, Ordering::SeqCst);
        let next = self.next.lock().unwrap().take()?;
        *self.current.lock().unwrap() = Some(next.clone());
        Some(next)
    }
}

fn client(fake: &FakePlatform) -> Platform {
    Platform::new(fake.url(), FakeTokens::new(Some("token-1"), None)).unwrap()
}

fn new_agent(name: &str, role: &str) -> NewAgent {
    NewAgent {
        nature: Nature {
            role: Some(NatureRole::of(role)),
            personality: Some(Personality::default()),
            languages: Some(vec!["ko".to_owned()]),
        },
        profile: Profile {
            name: Some(name.to_owned()),
            ..Profile::default()
        },
    }
}

#[test]
fn list_pages_and_maps_items() {
    let fake = FakePlatform::start();
    let ids: Vec<String> = (0..203)
        .map(|n| fake.state().add_agent(&format!("Agent {n}"), "work"))
        .collect();
    let gone = ids[5].clone();
    fake.state().agents[5].status = "deleted".to_owned();

    let agents = client(&fake).list_agents().unwrap();

    assert_eq!(agents.len(), 202, "the deleted agent is left out");
    assert!(agents.iter().all(|a| a.id != gone));
    assert_eq!(agents[0].id, ids[202], "newest first");
    assert_eq!(agents[0].name, "Agent 202");
    assert_eq!(agents[0].slug, "agent-202");
    assert_eq!(agents[0].status, AgentStatus::Active);
    assert_eq!(agents[0].avatar_url, None, "null reads as absent");
    assert_eq!(agents[0].personal_color.as_deref(), Some("#B6A3F5"));
    let pages = fake.seen_at("GET", "/api/v1/agents");
    let asked: Vec<(&str, &str)> = pages
        .iter()
        .map(|s| (s.query["page"].as_str(), s.query["limit"].as_str()))
        .collect();
    assert_eq!(asked, [("1", "200"), ("2", "200")]);
    let headers = &pages[0].headers;
    assert_eq!(headers["authorization"], "Bearer token-1");
    assert!(!headers.contains_key("origin"), "no Origin header");
}

#[test]
fn create_from_scratch_returns_the_new_id() {
    let fake = FakePlatform::start();
    let id = client(&fake)
        .create_agent(&new_agent("Miso", "Keeps my calendar"))
        .unwrap();

    let agent = fake.state().agent(&id).cloned().unwrap();
    assert_eq!((agent.name.as_str(), agent.slug.as_str()), ("Miso", "miso"));
    assert_eq!(agent.role, "Keeps my calendar");
    assert_eq!(agent.languages, ["ko"]);
    let body = &fake.seen_at("POST", "/api/v1/agents")[0].body;
    assert_eq!(body["nature"]["role"]["prompts"][0], "Keeps my calendar");
    assert_eq!(body["nature"]["personality"]["rigor"], 0.85);
    assert_eq!(body["profile"]["name"], "Miso");
    assert_eq!(client(&fake).get_agent(&id).unwrap().name, "Miso");
}

#[test]
fn create_from_catalog_uses_the_slug() {
    let fake = FakePlatform::start();
    let used = client(&fake).use_catalog("support-mail", "ko").unwrap();

    let seen = fake.seen_at("POST", "/api/v1/agent-catalog/agents/support-mail/use");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].body["locale"], "ko");
    assert_eq!(used.catalog.slug, "support-mail");
    assert_eq!(used.catalog.version, 3);
    assert_eq!(used.applied.skills, ["mail-triage"]);
    assert_eq!(used.warnings[0].step, "model");
    assert_eq!(used.recommended.connectors[0].kind, "gmail");
    let agent = client(&fake).get_agent(&used.agent_id).unwrap();
    assert_eq!(
        agent.source_catalog.unwrap().catalog_agent_id,
        "cat_support_mail"
    );

    let missing = client(&fake).use_catalog("no-such", "en").unwrap_err();
    assert_eq!(missing.kind, ErrorKind::NotFound);
}

#[test]
fn update_and_set_status() {
    let fake = FakePlatform::start();
    let id = fake.state().add_agent("Miso", "Mail");
    let platform = client(&fake);
    let patch = AgentPatch {
        nature: Some(Nature {
            role: Some(NatureRole::of("Calendar")),
            ..Nature::default()
        }),
        profile: Some(Profile {
            name: Some("Miso 2".to_owned()),
            ..Profile::default()
        }),
    };
    platform.update_agent(&id, &patch).unwrap();
    let agent = fake.state().agent(&id).cloned().unwrap();
    assert_eq!(
        (agent.name.as_str(), agent.role.as_str()),
        ("Miso 2", "Calendar")
    );
    assert_eq!(agent.slug, "miso", "the slug never changes");
    let empty = platform
        .update_agent(&id, &AgentPatch::default())
        .unwrap_err();
    assert_eq!(empty.kind, ErrorKind::Invalid);

    platform.set_status(&id, Switch::Inactive).unwrap();
    assert_eq!(
        platform.get_agent(&id).unwrap().status,
        AgentStatus::Inactive
    );
    platform.set_status(&id, Switch::Inactive).unwrap();
    assert_eq!(
        fake.seen_at("PUT", &format!("/api/v1/agents/{id}/status"))
            .len(),
        2
    );
    platform.set_status(&id, Switch::Active).unwrap();
    assert_eq!(platform.get_agent(&id).unwrap().status, AgentStatus::Active);
}

#[test]
fn delete_is_soft() {
    let fake = FakePlatform::start();
    let id = fake.state().add_agent("Miso", "Mail");
    let keep = fake.state().add_agent("Kept", "Mail");
    let platform = client(&fake);

    platform.delete_agent(&id).unwrap();

    assert_eq!(
        platform.get_agent(&id).unwrap().status,
        AgentStatus::Deleted
    );
    let left: Vec<String> = platform
        .list_agents()
        .unwrap()
        .into_iter()
        .map(|a| a.id)
        .collect();
    assert_eq!(left, [keep]);
    let again = platform.delete_agent(&id).unwrap_err();
    assert_eq!(again.kind, ErrorKind::NotFound, "already deleted");
    assert_eq!(again.code.as_deref(), Some("ALREADY_DELETED"));
}

#[test]
fn refreshes_once_on_401() {
    let fake = FakePlatform::start();
    fake.state().refuse("token-1");
    fake.state().accept("token-2");
    let tokens = FakeTokens::new(Some("token-1"), Some("token-2"));
    let platform = Platform::new(fake.url(), tokens.clone()).unwrap();

    assert!(platform.list_agents().unwrap().is_empty());
    assert_eq!(tokens.refreshes.load(Ordering::SeqCst), 1);
    let auth: Vec<String> = fake
        .seen()
        .iter()
        .map(|s| s.headers["authorization"].clone())
        .collect();
    assert_eq!(auth, ["Bearer token-1", "Bearer token-2"]);

    // A refresh that gives nothing new: signed out, after one try and no second.
    fake.state().refuse("token-2");
    let error = platform.list_agents().unwrap_err();
    assert_eq!(error.kind, ErrorKind::SignedOut);
    assert_eq!(tokens.refreshes.load(Ordering::SeqCst), 2);
    assert_eq!(fake.seen().len(), 3);

    let signed_out = Platform::new(fake.url(), FakeTokens::new(None, None)).unwrap();
    assert_eq!(
        signed_out.list_agents().unwrap_err().kind,
        ErrorKind::SignedOut
    );
    assert_eq!(fake.seen().len(), 3, "no token, no request");
}

#[test]
fn maps_error_envelope() {
    let fake = FakePlatform::start();
    let platform = client(&fake);
    let cases = [
        (403, "FORBIDDEN", ErrorKind::Forbidden),
        (404, "NOT_FOUND", ErrorKind::NotFound),
        (410, "GONE", ErrorKind::NotFound),
        (400, "VALIDATION_ERROR", ErrorKind::Invalid),
        (422, "UNPROCESSABLE", ErrorKind::Invalid),
        (500, "INTERNAL", ErrorKind::Failed),
    ];
    for (status, code, kind) in cases {
        fake.state().fail_next(status, code, "the platform says no");
        let error = platform.get_agent("ag_1").unwrap_err();
        assert_eq!((error.kind, error.status), (kind, Some(status)), "{status}");
        assert_eq!(error.code.as_deref(), Some(code));
        assert_eq!(error.message, "the platform says no");
    }
    let foreign = fake.state().add_foreign_agent("Theirs");
    assert_eq!(
        platform.get_agent(&foreign).unwrap_err().kind,
        ErrorKind::Forbidden
    );

    fake.state().delay = Some(Duration::from_millis(1500));
    let slow = Platform::new(fake.url(), FakeTokens::new(Some("token-1"), None))
        .unwrap()
        .with_timeout(Duration::from_millis(300));
    assert_eq!(slow.list_agents().unwrap_err().kind, ErrorKind::Offline);
    fake.state().delay = None;

    let closed = Platform::new("http://127.0.0.1:9", FakeTokens::new(Some("t"), None)).unwrap();
    assert_eq!(closed.list_agents().unwrap_err().kind, ErrorKind::Offline);
}
