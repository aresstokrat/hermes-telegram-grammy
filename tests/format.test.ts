import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeTelegramHtml, splitTelegramMessage } from "../src/format.js";

describe("Telegram formatting", () => {
  it("escapes HTML special characters", () => {
    assert.equal(escapeTelegramHtml("<tag> & value"), "&lt;tag&gt; &amp; value");
  });

  it("splits long Telegram messages", () => {
    const chunks = splitTelegramMessage("a".repeat(9000), 4096);
    assert.equal(chunks.length, 3);
    assert.equal(chunks.every((chunk) => chunk.length <= 4096), true);
    assert.equal(chunks.join(""), "a".repeat(9000));
  });

  it("prefers newline boundaries when splitting", () => {
    const chunks = splitTelegramMessage("hello\nworld\nagain", 12);
    assert.deepEqual(chunks, ["hello\nworld", "\nagain"]);
  });
});
