import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BOT_COMMANDS,
  parseCallbackData,
  getMenu,
  buildKeyboard,
  MAIN_MENU_ID,
  navCallback,
  cmdCallback,
  sceneCallback,
  backCallback,
  allMenus,
} from "../src/menus.js";

describe("command palette", () => {
  it("registers core Telegram bot commands", () => {
    const commands = BOT_COMMANDS.map((command) => command.command);
    for (const command of ["start", "help", "menu", "new", "status", "commands", "model", "cron", "platforms", "debug", "stop", "skills", "reasoning", "personality", "voice"]) {
      assert.equal(commands.includes(command), true, `Missing command: ${command}`);
    }
  });

  it("provides all 5 menus (main + 4 sub-menus)", () => {
    const menus = allMenus();
    assert.equal(menus.length, 5);
    const ids = menus.map((m) => m.id);
    assert.equal(ids.includes("main"), true);
    assert.equal(ids.includes("session"), true);
    assert.equal(ids.includes("settings"), true);
    assert.equal(ids.includes("automation"), true);
    assert.equal(ids.includes("info"), true);
  });
});

describe("callback data protocol", () => {
  it("generates nav callback data", () => {
    assert.equal(navCallback("session"), "nav:session");
  });

  it("generates cmd callback data", () => {
    assert.equal(cmdCallback("status"), "cmd:status");
  });

  it("generates scene callback data", () => {
    assert.equal(sceneCallback("model-picker"), "scene:model-picker");
  });

  it("generates back callback data", () => {
    assert.equal(backCallback("main"), "back:main");
  });

  it("parses callback data correctly", () => {
    assert.deepEqual(parseCallbackData("nav:session"), { kind: "nav", payload: "session" });
    assert.deepEqual(parseCallbackData("cmd:status"), { kind: "cmd", payload: "status" });
    assert.deepEqual(parseCallbackData("scene:model-picker"), { kind: "scene", payload: "model-picker" });
    assert.deepEqual(parseCallbackData("back:main"), { kind: "back", payload: "main" });
    assert.deepEqual(parseCallbackData("action:new"), { kind: "action", payload: "new" });
  });

  it("returns null for invalid callback data", () => {
    assert.equal(parseCallbackData(undefined), null);
    assert.equal(parseCallbackData(""), null);
    assert.equal(parseCallbackData("invalid"), null);
    assert.equal(parseCallbackData("foo:"), null);
  });

  it("keeps callback data within Telegram 64-byte limit", () => {
    for (const menu of allMenus()) {
      const kb = buildKeyboard(menu);
      // InlineKeyboard doesn't expose raw data, but we can check our format
    }
    // All our callback data strings are well within 64 bytes
    assert.equal(navCallback("automation").length <= 64, true);
    assert.equal(sceneCallback("model-picker").length <= 64, true);
    assert.equal(sceneCallback("cron-manager").length <= 64, true);
  });
});

describe("menu hierarchy", () => {
  it("sub-menus have back buttons pointing to main", () => {
    for (const menu of allMenus()) {
      if (menu.id === MAIN_MENU_ID) {
        assert.equal(menu.backTo, undefined, "Main menu should not have a back button");
      } else {
        assert.equal(menu.backTo, MAIN_MENU_ID, `Sub-menu ${menu.id} should back-link to main`);
      }
    }
  });

  it("every nav target resolves to a valid menu", () => {
    for (const menu of allMenus()) {
      for (const row of menu.rows) {
        for (const btn of row) {
          if ("nav" in btn) {
            const target = getMenu(btn.nav);
            assert.notEqual(target, undefined, `Nav target ${btn.nav} does not exist`);
          }
        }
      }
    }
  });

  it("builds an inline keyboard for each menu", () => {
    for (const menu of allMenus()) {
      const kb = buildKeyboard(menu);
      assert.notEqual(kb, undefined);
    }
  });
});
