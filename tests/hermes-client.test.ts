import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient, formatHeartbeat, type HeartbeatInfo } from "../src/hermes-client.js";

/** Build a mock SSE response body from an array of events */
function buildSSEBody(events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n`).join("\n");
}

/** Create a mock fetch that returns SSE stream */
function createSSEFetch(events: Array<{ event: string; data: unknown }>) {
  const sseBody = buildSSEBody(events);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseBody));
      controller.close();
    },
  });

  const calls: Array<[string, RequestInit]> = [];
  const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push([String(url), init ?? {}]);
    return new Response(stream as any, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { fetchMock, calls };
}

describe("HermesClient", () => {
  it("sends messages through the streaming API with a named conversation", async () => {
    const { fetchMock, calls } = createSSEFetch([
      { event: "response.created", data: { type: "response.created", response: { id: "resp_1", status: "in_progress" }, sequence_number: 0 } },
      { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { id: "msg_1", type: "message", status: "in_progress", role: "assistant", content: [] }, sequence_number: 1 } },
      { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Done", sequence_number: 2 } },
      { event: "response.output_item.done", data: { type: "response.output_item.done", output_index: 0, item: { id: "msg_1", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "Done" }] }, sequence_number: 3 } },
      { event: "response.completed", data: { type: "response.completed", response: { id: "resp_1", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }] }, sequence_number: 4 } },
    ]);

    const client = new HermesClient({ baseUrl: "http://hermes.local", apiKey: "secret", fetchImpl: fetchMock });
    const result = await client.sendMessage({ input: "hello", conversation: "telegram:1:0" });

    assert.equal(result.text, "Done");
    assert.equal(calls[0][0], "http://hermes.local/v1/responses");
    assert.equal(calls[0][1].method, "POST");
    assert.equal((calls[0][1].headers as Record<string, string>).Authorization, "Bearer secret");

    const body = JSON.parse(String(calls[0][1].body));
    assert.equal(body.model, "hermes-agent");
    assert.equal(body.input, "hello");
    assert.equal(body.conversation, "telegram:1:0");
    assert.equal(body.stream, true);
    assert.equal(body.store, true);
  });

  it("reads health status", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push([String(url), init ?? {}]);
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    };
    const client = new HermesClient({ baseUrl: "http://hermes.local/", apiKey: "secret", fetchImpl: fetchMock });

    assert.deepEqual(await client.health(), { status: "ok" });
    assert.equal(calls[0][0], "http://hermes.local/health/detailed");
  });

  it("calls heartbeat callback every N transitions", async () => {
    // Build 10 output_item.added events (transitions)
    const events: Array<{ event: string; data: unknown }> = [
      { event: "response.created", data: { type: "response.created", response: { id: "resp_2", status: "in_progress" }, sequence_number: 0 } },
    ];
    for (let i = 0; i < 10; i++) {
      events.push({ event: "response.output_item.added", data: { type: "response.output_item.added", output_index: i, sequence_number: i + 1 } });
      events.push({ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: i, sequence_number: i + 100 } });
    }
    events.push({
      event: "response.completed",
      data: {
        type: "response.completed",
        response: { id: "resp_2", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "result" }] }] },
        sequence_number: 200,
      },
    });

    const { fetchMock } = createSSEFetch(events);
    const client = new HermesClient({ baseUrl: "http://hermes.local", apiKey: "secret", fetchImpl: fetchMock });

    const heartbeats: HeartbeatInfo[] = [];
    const result = await client.sendMessage(
      { input: "/platforms", conversation: "telegram:test" },
      async (info) => { heartbeats.push({ ...info }); },
    );

    assert.equal(result.text, "result");
    // With HEARTBEAT_EVERY=5 and 10 transitions: should get 2 heartbeats (at #5 and #10)
    assert.equal(heartbeats.length, 2);
    assert.equal(heartbeats[0].transitionCount, 5);
    assert.equal(heartbeats[0].taskSummary, "/platforms");
    assert.equal(heartbeats[1].transitionCount, 10);
  });
});

describe("formatHeartbeat", () => {
  it("formats heartbeat with seconds only", () => {
    const text = formatHeartbeat({ taskSummary: "/platforms", elapsedSec: 23, transitionCount: 5 });
    assert.ok(text.includes("/platforms"));
    assert.ok(text.includes("23s"));
    assert.ok(text.includes("step 5"));
  });

  it("formats heartbeat with minutes and seconds", () => {
    const text = formatHeartbeat({ taskSummary: "/cron create", elapsedSec: 125, transitionCount: 15 });
    assert.ok(text.includes("2m 5s"));
    assert.ok(text.includes("step 15"));
  });

  it("formats heartbeat with long task name truncated", () => {
    const longTask = "This is a very long task description that should be truncated";
    const text = formatHeartbeat({ taskSummary: longTask.slice(0, 40) + "…", elapsedSec: 10, transitionCount: 5 });
    assert.ok(text.length < 200);
  });
});
