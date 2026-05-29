// ─── grammY Conversations for stateful multi-step flows ───
//
// Uses @grammyjs/conversations for interactive forms:
//   - Model picker: shows available models, user selects one
//   - Reasoning picker: select reasoning level
//   - Personality picker: select from personality list
//   - Cron manager: create / pause / resume / remove cron jobs
//
// All conversations forward the final selection to Hermes via the API.

import { InlineKeyboard } from "grammy";
import {
  conversations,
  createConversation,
  type Conversation,
  type ConversationFlavor,
} from "@grammyjs/conversations";
import { escapeTelegramHtml } from "./format.js";
import type { HermesClient } from "./hermes-client.js";

// ─── Type for context with conversation support ────────────────────

type MyContext = ConversationFlavor<any>;
type Conv = Conversation<MyContext>;

// ─── Model picker conversation ──────────────────────────────────────

const AVAILABLE_MODELS = [
  { id: "zai-org/GLM-5.1-FP8", label: "GLM-5.1-FP8" },
  { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" },
  { id: "grok-4.20-reasoning", label: "Grok 4.20" },
  { id: "gpt-image-2-medium", label: "GPT Image 2" },
] as const;

async function modelPicker(
  conversation: Conv,
  ctx: MyContext,
): Promise<void> {
  const hermes = ctx.runtime.hermes as HermesClient;

  // Step 1: Show current model and available options
  const kb = new InlineKeyboard();
  for (let i = 0; i < AVAILABLE_MODELS.length; i++) {
    kb.text(AVAILABLE_MODELS[i].label, `model:${i}`);
    if (i % 2 === 1) kb.row();
  }
  kb.row().text("❌ Cancel", "model:cancel");

  await ctx.reply("<b>🧠 Select a model:</b>\n\nTap a model to switch, or Cancel to keep current.", {
    parse_mode: "HTML",
    reply_markup: kb,
  });

  // Step 2: Wait for selection
  const answer = await conversation.waitForCallbackQuery(/^model:/);
  const data = answer.callbackQuery.data!;

  if (data === "model:cancel") {
    await answer.answerCallbackQuery("Cancelled");
    await ctx.reply("Model selection cancelled.");
    return;
  }

  const idx = parseInt(data.split(":")[1], 10);
  const selected = AVAILABLE_MODELS[idx];
  if (!selected) {
    await answer.answerCallbackQuery("Invalid selection");
    return;
  }

  await answer.answerCallbackQuery(`Switching to ${selected.label}...`);

  // Step 3: Forward /model command to Hermes
  const result = await hermes.sendMessage({
    input: `/model ${selected.id}`,
    conversation: `telegram:model-picker:${ctx.from?.id ?? "unknown"}`,
  });

  const text = result.text || "Model switch request sent.";
  await ctx.reply(text);
}

// ─── Reasoning picker conversation ──────────────────────────────────

const REASONING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;

async function reasoningPicker(
  conversation: Conv,
  ctx: MyContext,
): Promise<void> {
  const hermes = ctx.runtime.hermes as HermesClient;

  const kb = new InlineKeyboard();
  for (let i = 0; i < REASONING_LEVELS.length; i++) {
    kb.text(REASONING_LEVELS[i], `reasoning:${i}`);
    if (i % 3 === 2) kb.row();
  }
  kb.row().text("❌ Cancel", "reasoning:cancel");

  await ctx.reply("<b>🧪 Select reasoning level:</b>", {
    parse_mode: "HTML",
    reply_markup: kb,
  });

  const answer = await conversation.waitForCallbackQuery(/^reasoning:/);
  const data = answer.callbackQuery.data!;

  if (data === "reasoning:cancel") {
    await answer.answerCallbackQuery("Cancelled");
    await ctx.reply("Reasoning selection cancelled.");
    return;
  }

  const idx = parseInt(data.split(":")[1], 10);
  const level = REASONING_LEVELS[idx];
  if (!level) {
    await answer.answerCallbackQuery("Invalid selection");
    return;
  }

  await answer.answerCallbackQuery(`Reasoning: ${level}`);

  const result = await hermes.sendMessage({
    input: `/reasoning ${level}`,
    conversation: `telegram:reasoning-picker:${ctx.from?.id ?? "unknown"}`,
  });

  await ctx.reply(result.text || `Reasoning set to ${level}.`);
}

// ─── Personality picker conversation ───────────────────────────────

const PERSONALITIES = [
  "helpful",
  "concise",
  "technical",
  "creative",
  "teacher",
  "pirate",
  "noir",
  "philosopher",
] as const;

async function personalityPicker(
  conversation: Conv,
  ctx: MyContext,
): Promise<void> {
  const hermes = ctx.runtime.hermes as HermesClient;

  const kb = new InlineKeyboard();
  for (let i = 0; i < PERSONALITIES.length; i++) {
    const p = PERSONALITIES[i];
    const emoji = personalityEmoji(p);
    kb.text(`${emoji} ${p}`, `personality:${i}`);
    if (i % 2 === 1) kb.row();
  }
  kb.row().text("❌ Cancel", "personality:cancel");

  await ctx.reply("<b>🎭 Select a personality:</b>", {
    parse_mode: "HTML",
    reply_markup: kb,
  });

  const answer = await conversation.waitForCallbackQuery(/^personality:/);
  const data = answer.callbackQuery.data!;

  if (data === "personality:cancel") {
    await answer.answerCallbackQuery("Cancelled");
    await ctx.reply("Personality selection cancelled.");
    return;
  }

  const idx = parseInt(data.split(":")[1], 10);
  const personality = PERSONALITIES[idx];
  if (!personality) {
    await answer.answerCallbackQuery("Invalid selection");
    return;
  }

  await answer.answerCallbackQuery(`Personality: ${personality}`);

  const result = await hermes.sendMessage({
    input: `/personality ${personality}`,
    conversation: `telegram:personality-picker:${ctx.from?.id ?? "unknown"}`,
  });

  await ctx.reply(result.text || `Personality set to ${personality}.`);
}

function personalityEmoji(p: string): string {
  const map: Record<string, string> = {
    helpful: "😊",
    concise: "✂️",
    technical: "🔧",
    creative: "🎨",
    teacher: "👩‍🏫",
    pirate: "🏴‍☠️",
    noir: "🕵️",
    philosopher: "🤔",
  };
  return map[p] ?? "🎭";
}

// ─── Cron manager conversation ──────────────────────────────────────

async function cronManager(
  conversation: Conv,
  ctx: MyContext,
): Promise<void> {
  const hermes = ctx.runtime.hermes as HermesClient;

  // Step 1: Show current cron jobs + action buttons
  const kb = new InlineKeyboard()
    .text("📋 List Jobs", "cron:list")
    .row()
    .text("➕ Create", "cron:create")
    .row()
    .text("⏸ Pause", "cron:pause")
    .text("▶️ Resume", "cron:resume")
    .row()
    .text("🗑 Remove", "cron:remove")
    .row()
    .text("❌ Close", "cron:close");

  await ctx.reply("<b>⏱ Cron Job Manager</b>\n\nSelect an action:", {
    parse_mode: "HTML",
    reply_markup: kb,
  });

  const answer = await conversation.waitForCallbackQuery(/^cron:/);
  const action = answer.callbackQuery.data!.slice(5);

  await answer.answerCallbackQuery();

  switch (action) {
    case "list": {
      const result = await hermes.sendMessage({
        input: "/cron list",
        conversation: `telegram:cron:${ctx.from?.id ?? "unknown"}`,
      });
      await ctx.reply(result.text || "No cron jobs found.");
      break;
    }

    case "create": {
      // Ask for schedule
      await ctx.reply("📝 Enter the schedule:\n\nExamples: <code>30m</code>, <code>every 2h</code>, <code>0 9 * * *</code>, <code>2026-06-01T09:00:00</code>", {
        parse_mode: "HTML",
      });

      const scheduleCtx = await conversation.waitFor("message:text");
      const schedule = scheduleCtx.msg.text.trim();

      // Ask for prompt
      await ctx.reply("📝 Enter the prompt (what should the cron job do):");

      const promptCtx = await conversation.waitFor("message:text");
      const prompt = promptCtx.msg.text.trim();

      // Confirm
      const confirmKb = new InlineKeyboard()
        .text("✅ Create", "cron-confirm:yes")
        .text("❌ Cancel", "cron-confirm:no");

      await ctx.reply(
        `<b>Confirm cron job:</b>\n\nSchedule: <code>${escapeTelegramHtml(schedule)}</code>\nPrompt: <code>${escapeTelegramHtml(prompt)}</code>`,
        { parse_mode: "HTML", reply_markup: confirmKb },
      );

      const confirm = await conversation.waitForCallbackQuery(/^cron-confirm:/);
      await confirm.answerCallbackQuery();

      if (confirm.callbackQuery.data === "cron-confirm:yes") {
        const result = await hermes.sendMessage({
          input: `/cron create --schedule "${schedule}" ${prompt}`,
          conversation: `telegram:cron-create:${ctx.from?.id ?? "unknown"}`,
        });
        await ctx.reply(result.text || "Cron job creation request sent.");
      } else {
        await ctx.reply("Cron job creation cancelled.");
      }
      break;
    }

    case "pause":
    case "resume":
    case "remove": {
      await ctx.reply(`📝 Enter the cron job ID to ${action}:`);

      const idCtx = await conversation.waitFor("message:text");
      const jobId = idCtx.msg.text.trim();

      const result = await hermes.sendMessage({
        input: `/cron ${action} ${jobId}`,
        conversation: `telegram:cron-${action}:${ctx.from?.id ?? "unknown"}`,
      });
      await ctx.reply(result.text || `Cron ${action} request sent.`);
      break;
    }

    case "close": {
      await ctx.reply("Cron manager closed.");
      break;
    }
  }
}

// ─── Export all conversations for registration ─────────────────────

export const conversationsList = [
  createConversation(modelPicker, "model-picker"),
  createConversation(reasoningPicker, "reasoning-picker"),
  createConversation(personalityPicker, "personality-picker"),
  createConversation(cronManager, "cron-manager"),
];

export { conversations };
