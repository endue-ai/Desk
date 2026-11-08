import { describe, expect, it, vi } from "vitest";
import { createVoice, pickVoice } from "../ui/voice.js";

const voice = (name: string, lang = "en-US") => ({ name, lang }) as SpeechSynthesisVoice;

describe("Eris's voice", () => {
  it("is a female English voice, best match first", () => {
    const voices = [voice("Daniel", "en-GB"), voice("Samantha"), voice("Ava (Premium)")];
    expect(pickVoice(voices)?.name).toBe("Samantha");
    expect(pickVoice([voice("Microsoft Zira Desktop")])?.name).toBe("Microsoft Zira Desktop");
  });

  it("is no voice at all rather than someone else's", () => {
    expect(pickVoice([voice("Daniel", "en-GB"), voice("Samantha", "ko-KR")])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });

  it("stays silent in automated browsers", () => {
    const speak = vi.fn();
    const win = {
      navigator: { webdriver: true },
      speechSynthesis: { speak, cancel: vi.fn(), getVoices: () => [voice("Samantha")] },
      SpeechSynthesisUtterance: class {},
    };
    createVoice(win).speak("Hello.");
    expect(speak).not.toHaveBeenCalled();
  });

  it("speaks with the chosen voice otherwise", () => {
    const speak = vi.fn();
    const win = {
      navigator: { webdriver: false },
      speechSynthesis: { speak, cancel: vi.fn(), getVoices: () => [voice("Samantha")] },
      SpeechSynthesisUtterance: class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      },
    };
    createVoice(win).speak("I'm E.R.I.S.");
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0]?.[0]).toMatchObject({ text: "I'm E. R. I. S.", pitch: 1.05 });
  });
});
