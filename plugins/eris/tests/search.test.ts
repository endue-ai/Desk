import { expect, it, vi } from "vitest";
import { conversationSearch } from "../ui/search.js";

it("restores a searchable exchange without sending it to the brain again", async () => {
  const handlers = new Map<string, (args: unknown) => unknown>();
  const call = vi
    .fn()
    .mockResolvedValue({ value: [{ id: "turn1", prompt: "서울 출장", answer: "기차를 타세요" }] });
  const show = vi.fn();
  const search = await conversationSearch(
    {
      bridge: { call },
      commands: {
        on: (id: string, handler: (args: unknown) => unknown) => handlers.set(id, handler),
      },
    },
    show,
  );
  handlers.get("endue.eris.search-open")?.({ turn: "turn1" });
  expect(show).toHaveBeenCalledWith("서울 출장", "기차를 타세요");
  await search.add({ id: "turn2", prompt: "다음 일정", answer: "회의" });
  expect(call.mock.calls.at(-1)).toMatchObject([
    "search.replace",
    {
      documents: [
        { id: "turn1", command: "endue.eris.search-open" },
        { id: "turn2", text: "다음 일정\n회의" },
      ],
    },
  ]);
  expect(call.mock.calls.some(([method]) => method === "brain.say")).toBe(false);
});
