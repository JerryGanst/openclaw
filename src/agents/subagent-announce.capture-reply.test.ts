import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readLatestAssistantReplyMock, chatHistoryMock } = vi.hoisted(() => ({
  readLatestAssistantReplyMock:
    vi.fn<(params: { sessionKey: string; limit?: number }) => Promise<string | undefined>>(),
  chatHistoryMock: vi.fn<(sessionKey: string) => Promise<{ messages?: Array<unknown> }>>(
    async () => ({
      messages: [],
    }),
  ),
}));

vi.mock("./tools/agent-step.js", () => ({
  readLatestAssistantReply: readLatestAssistantReplyMock,
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(async (request: unknown) => {
    const typed = request as { method?: string; params?: { sessionKey?: string } };
    if (typed.method === "chat.history") {
      return await chatHistoryMock(typed.params?.sessionKey ?? "");
    }
    return {};
  }),
}));

import { captureSubagentCompletionReply } from "./subagent-announce.js";

describe("captureSubagentCompletionReply", () => {
  beforeEach(() => {
    readLatestAssistantReplyMock.mockReset().mockResolvedValue(undefined);
    chatHistoryMock.mockReset().mockResolvedValue({ messages: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediate assistant output when available", async () => {
    readLatestAssistantReplyMock.mockResolvedValueOnce("immediate output");

    const result = await captureSubagentCompletionReply("agent:main:subagent:immediate");

    expect(result).toBe("immediate output");
    expect(chatHistoryMock).not.toHaveBeenCalled();
  });

  it("falls back to parsed chat history when latest assistant reply is empty", async () => {
    readLatestAssistantReplyMock.mockResolvedValueOnce("");
    chatHistoryMock.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "ignore user message" },
        { role: "assistant", content: "history output" },
      ],
    });

    const result = await captureSubagentCompletionReply("agent:main:subagent:history");

    expect(result).toBe("history output");
  });

  it("retries until output appears", async () => {
    vi.useFakeTimers();
    readLatestAssistantReplyMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("late output");

    const resultPromise = captureSubagentCompletionReply("agent:main:subagent:retry");

    await vi.advanceTimersByTimeAsync(200);
    await expect(resultPromise).resolves.toBe("late output");
  });

  it("returns undefined when no output arrives before timeout", async () => {
    vi.useFakeTimers();
    readLatestAssistantReplyMock.mockResolvedValue(undefined);
    chatHistoryMock.mockResolvedValue({ messages: [] });

    const resultPromise = captureSubagentCompletionReply("agent:main:subagent:none");

    await vi.advanceTimersByTimeAsync(1_600);
    await expect(resultPromise).resolves.toBeUndefined();
    expect(readLatestAssistantReplyMock.mock.calls.length).toBeGreaterThan(1);
  });
});
