// ─── Hierarchical menu system for Hermes Telegram grammY sidecar ───
//
// Two-level navigation:
//   Main menu → 4 category sub-menus → action buttons
//
// Callback data protocol:
//   nav:<menu_id>    — navigate to sub-menu
//   cmd:<command>    — execute a slash-command (forwarded to Hermes)
//   scene:<scene_id> — enter a grammY conversation/scene
//   back:<menu_id>   — return to parent menu

// ─── Types ───────────────────────────────────────────────────────────

export type BotCommandDefinition = {
  command: string;
  description: string;
};

export type MenuButton =
  | { text: string; nav: string }               // navigate to sub-menu
  | { text: string; cmd: string }                // forward slash-command to Hermes
  | { text: string; scene: string }              // enter a scene/conversation
  | { text: string; action: string };            // local handler action

export type MenuDefinition = {
  id: string;
  title: string;
  description?: string;
  rows: MenuButton[][];
  backTo?: string; // parent menu id
};

// ─── Callback data helpers ─────────────────────────────────────────

export function navCallback(menuId: string): string {
  return `nav:${menuId}`;
}

export function cmdCallback(command: string): string {
  return `cmd:${command}`;
}

export function sceneCallback(sceneId: string): string {
  return `scene:${sceneId}`;
}

export function backCallback(menuId: string): string {
  return `back:${menuId}`;
}

export type CallbackKind = "nav" | "cmd" | "scene" | "back" | "action";

export function parseCallbackData(data: string | undefined): { kind: CallbackKind; payload: string } | null {
  if (!data) return null;
  const idx = data.indexOf(":");
  if (idx === -1) return null;
  const kind = data.slice(0, idx) as CallbackKind;
  const payload = data.slice(idx + 1);
  if (!payload) return null;
  if (!["nav", "cmd", "scene", "back", "action"].includes(kind)) return null;
  return { kind, payload };
}

// ─── Bot commands (for /command palette) ──────────────────────────

export const BOT_COMMANDS: BotCommandDefinition[] = [
  { command: "start", description: "Start the Hermes Telegram sidecar" },
  { command: "help", description: "Show help" },
  { command: "menu", description: "Open main menu" },
  { command: "new", description: "Start a fresh Hermes conversation" },
  { command: "status", description: "Show Hermes API status" },
  { command: "commands", description: "List available commands" },
  { command: "stop", description: "Stop or interrupt current work" },
  { command: "model", description: "Change AI model" },
  { command: "cron", description: "Manage cron jobs" },
  { command: "platforms", description: "Show platform status" },
  { command: "debug", description: "Show debug info" },
  { command: "skills", description: "Manage skills" },
  { command: "reasoning", description: "Set reasoning level" },
  { command: "personality", description: "Set personality" },
  { command: "voice", description: "Toggle voice mode" },
];

// ─── Menu definitions ──────────────────────────────────────────────

const MAIN: MenuDefinition = {
  id: "main",
  title: "🤖 Hermes Control Panel",
  description: "Choose a category:",
  rows: [
    [
      { text: "💬 Session", nav: "session" },
      { text: "⚙️ Settings", nav: "settings" },
    ],
    [
      { text: "🤖 Automation", nav: "automation" },
      { text: "ℹ️ Info", nav: "info" },
    ],
  ],
};

const SESSION: MenuDefinition = {
  id: "session",
  title: "💬 Session",
  description: "Manage your Hermes conversation session:",
  rows: [
    [
      { text: "🆕 New", action: "new" },
      { text: "📊 Status", cmd: "status" },
    ],
    [
      { text: "⏹ Stop", cmd: "stop" },
      { text: "🔄 Resume", action: "resume" },
    ],
    [
      { text: "📋 History", action: "history" },
    ],
  ],
  backTo: "main",
};

const SETTINGS: MenuDefinition = {
  id: "settings",
  title: "⚙️ Settings",
  description: "Configure Hermes behavior:",
  rows: [
    [
      { text: "🧠 Model", scene: "model-picker" },
      { text: "🧪 Reasoning", scene: "reasoning-picker" },
    ],
    [
      { text: "🎙 Voice", action: "voice" },
      { text: "🎭 Personality", scene: "personality-picker" },
    ],
  ],
  backTo: "main",
};

const AUTOMATION: MenuDefinition = {
  id: "automation",
  title: "🤖 Automation",
  description: "Manage scheduled tasks and extensions:",
  rows: [
    [
      { text: "⏱ Cron Jobs", scene: "cron-manager" },
      { text: "📦 Skills", cmd: "skills" },
    ],
    [
      { text: "🔗 Webhooks", action: "webhooks" },
    ],
  ],
  backTo: "main",
};

const INFO: MenuDefinition = {
  id: "info",
  title: "ℹ️ Information",
  description: "System info and diagnostics:",
  rows: [
    [
      { text: "🌉 Platforms", cmd: "platforms" },
      { text: "🧪 Debug", cmd: "debug" },
    ],
    [
      { text: "📚 Commands", action: "commands" },
      { text: "❔ Help", action: "help" },
    ],
  ],
  backTo: "main",
};

// ─── Menu registry ─────────────────────────────────────────────────

const ALL_MENUS: MenuDefinition[] = [MAIN, SESSION, SETTINGS, AUTOMATION, INFO];

const menuById = new Map(ALL_MENUS.map((m) => [m.id, m]));

export function getMenu(id: string): MenuDefinition | undefined {
  return menuById.get(id);
}

export function allMenus(): MenuDefinition[] {
  return ALL_MENUS;
}

export const MAIN_MENU_ID = "main";

// ─── Inline keyboard builder ──────────────────────────────────────

import { InlineKeyboard } from "grammy";

export function buildKeyboard(menu: MenuDefinition): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const row of menu.rows) {
    for (const btn of row) {
      if ("nav" in btn) kb.text(btn.text, navCallback(btn.nav));
      else if ("cmd" in btn) kb.text(btn.text, cmdCallback(btn.cmd));
      else if ("scene" in btn) kb.text(btn.text, sceneCallback(btn.scene));
      else if ("action" in btn) kb.text(btn.text, `action:${btn.action}`);
    }
    kb.row();
  }

  // Add back button if sub-menu
  if (menu.backTo) {
    kb.text("← Back", backCallback(menu.backTo));
  }

  return kb;
}
