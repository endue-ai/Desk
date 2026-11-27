use desk_brain_endue::HttpBrain;
use desk_core::BrainOptions;
use desk_platform::fake::FakeSpace;

use super::*;

const ASK: &str = "desk.endue.ask";
const RUN: &str = "/api/v1/ai/conversations/cnv_desk_1/runs";

fn params(agent: &str, space: Option<&str>) -> Value {
    let mut params = json!({
        "agentId": agent,
        "question": "What is ready for review?",
        "scope": {"permission": "studio:manage"}
    });
    if let Some(space) = space {
        params["spaceId"] = json!(space);
    }
    params
}

#[test]
fn the_shell_owns_the_bridge_and_a_replaced_front_desk_never_receives_the_question() {
    let fake = FakePlatform::start();
    let core = desk("studio-chat-scope", &fake);
    grant(&core, "desk", json!({"permission": "studio:manage"}));
    assert_eq!(
        call(&core, AGENTS, "studio.chat.ask", params("ag_front", None))
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert!(fake.seen().is_empty());
    let mut space = FakeSpace::new("sp_launch", "Launch");
    space.body["front_agent_id"] = json!("ag_front");
    fake.state().spaces.push(space);
    assert_eq!(
        call(
            &core,
            "desk",
            "studio.chat.ask",
            params("ag_old", Some("sp_launch"))
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidParams
    );
    assert!(
        fake.seen_at("POST", "/api/v1/spaces/sp_launch/conversation")
            .is_empty()
    );
    fake.state()
        .chat_conversations
        .insert("cnv_sp_launch".into(), "ag_old".into());
    assert_eq!(
        call(
            &core,
            "desk",
            "studio.chat.ask",
            params("ag_front", Some("sp_launch"))
        )
        .unwrap_err()
        .code,
        ErrorCode::InvalidParams
    );
    assert!(
        fake.seen_at("POST", "/api/v1/ai/conversations/cnv_sp_launch/runs")
            .is_empty()
    );
    fake.state().chat_conversations.clear();
    let reply = call(
        &core,
        "desk",
        "studio.chat.ask",
        params("ag_front", Some("sp_launch")),
    )
    .unwrap();
    assert_eq!(
        reply,
        json!({
            "state": "done", "agentId": "ag_front", "spaceId": "sp_launch",
            "conversationId": "cnv_sp_launch", "runId": "run_fixture", "text": "The outline is ready."
        })
    );
}

#[test]
fn eris_consumes_the_cloud_reply_only_after_the_person_approves() {
    let fake = FakePlatform::start();
    let agent = fake.state().add_agent("Fixture", "Read the outline");
    let echo = common::Echo::start();
    let room = home("studio-chat-eris");
    let init = room.join("init.yaml");
    fs::write(
        &init,
        "agents:\n  eris:\n    allow:\n      - { permission: cmd:invoke, ids: [desk.endue.ask] }\n",
    )
    .unwrap();
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let core = Arc::new(
        Core::new(roots(&room))
            .with_init_file(init)
            .with_platform(platform(&fake, Some("token-1")))
            .with_brain(brain, BrainOptions::default())
            .with_prompter(NeverAsk),
    );
    core.route_tools();
    for permission in ["brain:converse", "studio:manage", "perm:manage"] {
        grant(&core, "desk", json!({"permission": permission}));
    }
    let scope = json!({"permission": "cmd:invoke", "ids": [ASK]});
    grant(&core, "agent:eris", scope.clone());
    call(
        &core,
        "desk",
        "cmd.register",
        json!({
            "id": ASK, "title": "Ask an endue AI agent", "agent": true, "irreversible": true,
            "description": "Send one reviewed question to the selected cloud agent."
        }),
    )
    .unwrap();
    let events = core.events().subscribe_addressed();
    let ask = json!({"agentId": agent, "question": "What is ready for review?"});
    for choice in ["deny", "once"] {
        let prompt = format!("tool desk_endue_ask as eris: {ask}");
        let turn = call(
            &core,
            "desk",
            "brain.say",
            json!({
                "text": prompt, "scope": {"permission": "brain:converse"}
            }),
        )
        .unwrap();
        let approval = wait_for(&events, "perm.approval");
        assert_eq!(approval.data()["caller"], "agent:eris");
        assert!(fake.seen().is_empty());
        approve_as_desk(&core, &approval, choice);
        if choice == "once" {
            let invoked = wait_for(&events, "cmd.invoked");
            assert_eq!(invoked.data()["args"], ask);
            let reply = call(&core, "desk", "studio.chat.ask", params(&agent, None)).unwrap();
            call(
                &core,
                "desk",
                "cmd.answer",
                json!({
                    "invocationId": invoked.data()["invocationId"], "result": reply
                }),
            )
            .unwrap();
        }
        let mut output = String::new();
        loop {
            let event = wait_for(&events, "brain.turn");
            let data = event.data();
            if data["turnId"] != turn["turnId"] {
                continue;
            }
            match data["kind"].as_str() {
                Some("delta") => output.push_str(data["text"].as_str().unwrap()),
                Some("completed") => break,
                Some("error") => panic!("The brain turn failed: {data}"),
                _ => {}
            }
        }
        if choice == "deny" {
            assert!(output.contains("not-approved"), "{output}");
            assert!(fake.seen().is_empty());
        } else {
            assert!(output.contains("The outline is ready."), "{output}");
            assert_eq!(fake.seen_at("POST", RUN).len(), 1);
        }
    }
}
