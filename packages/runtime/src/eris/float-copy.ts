/** The floating Eris's words (ADR 0121), in the desk's two languages. */
import type { FloatStatus } from "./float";

export type FloatLang = "ko" | "en";

const COPY = {
  en: {
    summon: "Talk to Eris",
    figure: "Eris",
    talk: "Talk to Eris",
    placeholder: "Talk to Eris…",
    send: "Send",
    fold: "Fold",
    conversation: "Conversation with Eris",
    empty: "Ask her anything. She keeps one conversation with the desk.",
    hint: "{key} summons her anywhere",
    approval: "Eris is waiting for your approval in the desk.",
    reveal: "Open Desk",
    failed: "Eris could not answer. Try again.",
    you: "You",
    eris: "Eris",
  },
  ko: {
    summon: "Eris에게 말하기",
    figure: "Eris",
    talk: "Eris에게 말하기",
    placeholder: "Eris에게 말해 보세요…",
    send: "보내기",
    fold: "접기",
    conversation: "Eris와의 대화",
    empty: "무엇이든 물어보세요. 데스크와 같은 대화를 이어 가요.",
    hint: "{key}로 어디서든 불러요",
    approval: "Eris가 데스크에서 승인을 기다리고 있어요.",
    reveal: "데스크 열기",
    failed: "Eris가 답하지 못했어요. 다시 시도해 주세요.",
    you: "나",
    eris: "Eris",
  },
} as const;

const STATUS: Record<FloatLang, Record<FloatStatus, string>> = {
  en: {
    idle: "Ready",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    approval: "Waiting for your approval",
  },
  ko: {
    idle: "대기 중",
    listening: "듣는 중…",
    thinking: "생각하는 중…",
    speaking: "말하는 중…",
    approval: "승인을 기다리는 중",
  },
};

export type FloatCopy = keyof (typeof COPY)["en"];

export function floatText(lang: FloatLang, key: FloatCopy, vars: Record<string, string> = {}) {
  return COPY[lang][key].replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

export function statusText(lang: FloatLang, status: FloatStatus): string {
  return STATUS[lang][status];
}
