import { describe, expect, it } from "vitest";
import { isLookRequest } from "./look";

describe("a look request said to Eris", () => {
  it("is the theme, look or feel with a feeling, in English or Korean", () => {
    for (const text of [
      "make it feel like warm paper",
      "Make the theme darker and calmer",
      "I want a theme that feels like the ocean at night",
      "테마를 따뜻한 종이 느낌으로",
      "따뜻한 느낌으로 바꿔줘",
      "분위기를 차분한 숲처럼 해줘",
      "이끼 느낌으로",
    ])
      expect(isLookRequest(text), text).toBe(true);
  });

  it("is not a question about the theme, a request without a feeling, or anything else", () => {
    for (const text of [
      "what theme is this?",
      "I like this look",
      "change the theme",
      "지금 테마가 뭐야?",
      "테마 바꿔줘",
      "hello there",
      "make a note about the paper",
      "I feel like pizza",
      "I want to feel better",
      "이 테마 바꿔 줘",
    ])
      expect(isLookRequest(text), text).toBe(false);
  });
});
