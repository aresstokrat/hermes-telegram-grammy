import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BOT_COMMANDS, commandFromCallback, mainMenuRows } from "../src/menus.js";

describe("command palette", () => {
  it("registers core Telegram bot commands", () => {
    const commands = BOT_COMMANDS.map((command) => command.command);
    for (const command of ["start", "help", "menu", "new", "status", "commands", "model", "cron", "platforms", "debug", "stop"]) {
      assert.equal(commands.includes(command), true);
    }
  });

  it("renders compact callback data for menu buttons", () => {
    const callbacks = mainMenuRows().flat().map((button) => button.callbackData);
    assert.equal(callbacks.includes("cmd:status"), true);
    assert.equal(callbacks.includes("cmd:model"), true);
    assert.equal(callbacks.every((value) => value.length <= 64), true);
  });

  it("extracts a command from callback data", () => {
    assert.equal(commandFromCallback("cmd:status"), "status");
    assert.equal(commandFromCallback("noop"), null);
  });
});
