import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionStore } from "../src/sessions.js";

describe("session store", () => {
  it("builds stable conversation IDs per chat", () => {
    const store = new SessionStore("telegram");
    assert.equal(store.conversationFor({ chatId: "42" }), "telegram:42:0");
    assert.equal(store.conversationFor({ chatId: "42" }), "telegram:42:0");
  });

  it("includes thread IDs for topic isolation", () => {
    const store = new SessionStore("telegram");
    assert.equal(store.conversationFor({ chatId: "42", threadId: "7" }), "telegram:42:thread:7:0");
  });

  it("resets a conversation by incrementing generation", () => {
    const store = new SessionStore("telegram");
    store.reset({ chatId: "42" });
    assert.equal(store.conversationFor({ chatId: "42" }), "telegram:42:1");
  });
});
