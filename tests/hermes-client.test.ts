import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/hermes-client.js";

describe("HermesClient", () => {
  it("sends messages through the Responses API with a named conversation", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push([String(url), init ?? {}]);
      return new Response(JSON.stringify({
        id: "resp_1",
        output_text: "Done",
        output: [{ type: "message", content: [{ type: "output_text", text: "Done" }] }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = new HermesClient({ baseUrl: "http://hermes.local", apiKey: "secret", fetchImpl: fetchMock });
    const result = await client.sendMessage({ input: "hello", conversation: "telegram:1:0" });

    assert.equal(result.text, "Done");
    assert.equal(calls[0][0], "http://hermes.local/v1/responses");
    assert.equal(calls[0][1].method, "POST");
    assert.equal((calls[0][1].headers as Record<string, string>).Authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(String(calls[0][1].body)), {
      model: "hermes-agent",
      input: "hello",
      conversation: "telegram:1:0",
      store: true,
    });
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
});
