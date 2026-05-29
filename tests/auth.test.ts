import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAllowedUser, parseAllowedUsers } from "../src/auth.js";

describe("Telegram allowlist", () => {
  it("parses comma-separated Telegram user IDs", () => {
    assert.deepEqual(parseAllowedUsers("123, 456,,789"), new Set(["123", "456", "789"]));
  });

  it("denies users when allowlist is empty", () => {
    assert.equal(isAllowedUser("123", new Set()), false);
  });

  it("allows exact user ID matches", () => {
    assert.equal(isAllowedUser("123", new Set(["123"])), true);
    assert.equal(isAllowedUser("999", new Set(["123"]),), false);
  });

  it("supports wildcard allow-all for local testing", () => {
    assert.equal(isAllowedUser("999", new Set(["*"])), true);
  });
});
