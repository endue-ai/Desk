/**
 * Words of an endue agent's Studio board (ADR 0232), as endue.ai's Studio says them: the three
 * columns, their rows, the agent's sheet, and the sentence that says what the agent does.
 */
import type { Lang } from "../../shell/copy";

const copy = {
  // The columns.
  headIn: ["요청이 들어오는 곳", "Where requests come in"],
  headHub: ["에이전트가 처리하는 곳", "Where the agent handles them"],
  headOut: ["손이 닿는 곳", "What it reaches"],
  details: ["자세히", "Details"],
  on: ["켜짐", "On"],
  off: ["꺼짐", "Off"],
  onEndue: ["endue.ai 에서 확인", "See it on endue.ai"],
  opens: [
    "endue.ai 의 {name} 을 데스크 창에서 엽니다",
    "Shows {name} of endue.ai in a desk window",
  ],
  // Where requests come in.
  consoleTitle: ["콘솔 채팅", "Console chat"],
  consoleSub: ["기본 · 늘 켜짐", "Default · always on"],
  consoleBody: [
    "웹 · 데스크톱 · 모바일 앱에서 나누는 대화예요. 끌 수 없어요.",
    "Chats in the web, desktop and mobile apps. It can’t be turned off.",
  ],
  consoleOpen: ["대화 열기", "Open chat"],
  channelTitle: ["채널", "Channel"],
  channelSub: ["Slack · Discord · 카카오톡", "Slack · Discord · KakaoTalk"],
  channelBody: [
    "연결하면 그 채널에서 이 에이전트를 불러요.",
    "Connect one to call this agent from that channel.",
  ],
  channelAdd: ["채널 추가", "Add channel"],
  liveTitle: ["라이브", "Live"],
  liveSub: ["endue.live 공개", "Public on endue.live"],
  liveOn: [
    "공개 중이에요. 범위 안의 방문자가 이 주소에서 대화해요.",
    "Public. Visitors in the chosen scope chat at this address.",
  ],
  liveOff: ["켜면 {address} 에서 대화할 수 있어요.", "Turn it on to chat at {address}."],
  apiTitle: ["API", "API"],
  apiSub: ["내 서비스에서 키로 호출", "Call it with a key from your service"],
  apiBody: [
    "키를 만들면 엔드포인트와 호출 예시가 보여요.",
    "Create a key to see the endpoint and an example call.",
  ],
  apiCreate: ["키 만들기", "Create key"],
  mcpTitle: ["MCP", "MCP"],
  mcpSub: ["다른 에이전트 · 앱이 호출", "Other agents and apps call it"],
  mcpOn: [
    "바깥 에이전트가 MCP 로 이 에이전트를 실행할 수 있어요.",
    "Outside agents can run this agent over MCP.",
  ],
  mcpOff: [
    "켜면 다른 에이전트와 앱이 MCP 로 이 에이전트를 불러요.",
    "Turn it on so other agents and apps can call this agent over MCP.",
  ],
  mcpConnect: ["연결 방법", "How to connect"],
  // What it reaches.
  connectorsGroup: ["커넥터 {n}", "Connectors {n}"],
  manage: ["관리", "Manage"],
  connectorActive: ["사용 중", "Active"],
  connectorOff: ["꺼 둠", "Turned off"],
  connectorAttention: ["확인 필요", "Needs attention"],
  connectorUnverified: ["확인 전", "Not verified"],
  connectorsMore: ["커넥터 {n}개 더", "{n} more connectors"],
  addConnector: ["＋ 커넥터", "＋ Connector"],
  addConnectorHint: ["GitHub · Gmail · …", "GitHub · Gmail · …"],
  devicesTitle: ["디바이스", "Devices"],
  devicesSub: ["Computer · Chrome · Android", "Computer · Chrome · Android"],
  outputsTitle: ["결과물 · 워크스페이스", "Outputs · Workspace"],
  outputsSub: ["에이전트가 만든 것", "What the agent made"],
  outputsView: ["결과물 보기", "View outputs"],
  workspaceOpen: ["워크스페이스 열기", "Open workspace"],
  roadmap: ["로드맵", "Roadmap"],
  subAgents: ["서브 에이전트에게 나눠 맡기기", "Hand work to sub-agents"],
  // The agent's sheet.
  character: ["캐릭터", "Character"],
  identity: ["정체성", "Identity"],
  abilities: ["능력", "Abilities"],
  prompt: ["프롬프트", "Prompt"],
  memory: ["메모리", "Memory"],
  traits: ["성향", "Traits"],
  model: ["모델", "Model"],
  wallpaper: ["배경", "Wallpaper"],
  skills: ["스킬 {n}", "Skills {n}"],
  tools: ["내장 도구", "Built-in tools"],
  noPrompt: ["아직 쓰지 않았어요", "Not written yet"],
  defaultModel: ["기본", "Default"],
  addSkill: ["추가", "Add"],
  noSkills: ["아직 없어요", "None yet"],
  badgeOn: ["{name} · 켜짐", "{name} · on"],
  badgeOff: ["{name} · 꺼짐", "{name} · off"],
  profile: ["프로필", "Profile"],
  analytics: ["분석", "Analytics"],
  relations: ["관계", "Relations"],
  settings: ["설정", "Settings"],
  sentenceLabel: ["이 에이전트가 하는 일", "What this agent does"],
  legend: ["선 범례", "Line legend"],
  legendBad: ["문제", "Problem"],
  legendUnknown: ["여기서는 읽지 않음", "Not read here"],
  // Traits and the groups of built-in tools.
  personality: ["성격", "Personality"],
  self_evolving: ["성장형", "Self-evolving"],
  dream: ["Dream", "Dream"],
  self_config: ["Self Configuration", "Self Configuration"],
  autonomy: ["자율성", "Autonomy"],
  artifact: ["결과물", "Outputs"],
  routine: ["예약", "Schedules"],
  project: ["프로젝트", "Project"],
  skill_meta: ["스킬 메타", "Skill Meta"],
  visualize: ["그림 위젯", "Drawing widget"],
  connector_cards: ["카드 위젯", "Card widget"],
  web_fetch: ["웹 조회", "Web Fetch"],
  utility: ["유틸리티", "Utility"],
  workspace: ["디바이스", "Devices"],
  image: ["이미지 생성", "Image generation"],
} satisfies Record<string, [string, string]>;

export type BoardKey = keyof typeof copy;

export const isBoardKey = (key: string): key is BoardKey => Object.hasOwn(copy, key);

export function boardText(
  lang: Lang,
  key: BoardKey,
  vars: Record<string, string | number> = {},
): string {
  const [ko, en] = copy[key];
  return (lang === "ko" ? ko : en).replace(/\{(\w+)\}/g, (_, name: string) =>
    String(vars[name] ?? ""),
  );
}

/** A piece of the sentence: plain, in the brand's colour (`hl`), or a problem (`warn`). */
export interface Seg {
  text: string;
  tone?: "hl" | "warn";
}

/** What the sentence is made of: the ways in that are on, what handles a request, where it ends. */
export interface Capability {
  inputs: string[];
  skills: number;
  tools: number;
  outputs: string[];
  moreOutputs: number;
  broken: string[];
}

const hl = (text: string): Seg => ({ text, tone: "hl" });

/** The sentence under the agent's head: where requests come from, what handles them, where they end. */
export function capability(lang: Lang, f: Capability): Seg[] {
  const ko = lang === "ko";
  const outs = f.outputs.length ? `${f.outputs.join(" · ")}${more(ko, f.moreOutputs)} · ` : "";
  const end = hl(`${outs}${ko ? "결과물" : "Outputs"}`);
  const broken: Seg[] = f.broken.length
    ? [
        {
          text: `${ko ? " 다시 연결이 필요해요: " : " Needs reconnecting: "}${f.broken.join(" · ")}`,
          tone: "warn",
        },
      ]
    : [];
  if (ko) {
    const how: Seg[] =
      f.skills && f.tools
        ? [
            hl(`스킬 ${f.skills}개`),
            { text: "와 " },
            hl(`내장 도구 ${f.tools}개`),
            { text: "로 처리하고, " },
          ]
        : f.skills
          ? [hl(`스킬 ${f.skills}개`), { text: "로 처리하고, " }]
          : f.tools
            ? [hl(`내장 도구 ${f.tools}개`), { text: "로 처리하고, " }]
            : [{ text: "대화만으로 처리하고, " }];
    return [
      hl(f.inputs.join(" · ")),
      { text: " 에서 요청을 받아 " },
      ...how,
      { text: "결과를 " },
      end,
      { text: "에 남겨요." },
      ...broken,
    ];
  }
  const how: Seg[] =
    f.skills && f.tools
      ? [
          { text: "with " },
          hl(`${f.skills} skills`),
          { text: " and " },
          hl(`${f.tools} built-in tools`),
        ]
      : f.skills
        ? [{ text: "with " }, hl(`${f.skills} skills`)]
        : f.tools
          ? [{ text: "with " }, hl(`${f.tools} built-in tools`)]
          : [{ text: "in conversation" }];
  return [
    { text: "Takes requests from " },
    hl(f.inputs.join(" · ")),
    { text: ", handles them " },
    ...how,
    { text: ", and leaves results in " },
    end,
    { text: "." },
    ...broken,
  ];
}

const more = (ko: boolean, n: number) => (n ? (ko ? ` 외 ${n}` : ` +${n}`) : "");
