// ─── Hermes Telegram grammY sidecar — Bot with hierarchical menus ───
//
// Features used:
//   - grammY InlineKeyboard for hierarchical navigation
//   - @grammyjs/conversations for multi-step stateful flows
//   - callbackQuery routing with structured data (nav:/cmd:/scene:/back:/action:)
//   - Middleware for auth + logging
//   - Bot.api.setMyCommands for native command palette
//   - Chat action indicators (typing)
//   - Streaming text delivery: first chunk creates message, edits follow

import { Bot, Context, InlineKeyboard } from "grammy";
import { ConversationFlavor } from "@grammyjs/conversations";
import { isAllowedUser } from "./auth.js";
import { AppConfig } from "./config.js";
import { escapeTelegramHtml, splitTelegramMessage } from "./format.js";
import { HermesClient, formatHeartbeat, type HeartbeatInfo, type HermesResponsesInput, type TextChunk } from "./hermes-client.js";
import {
  BOT_COMMANDS,
  buildKeyboard,
  getMenu,
  MAIN_MENU_ID,
  parseCallbackData,
} from "./menus.js";
import { SessionStore } from "./sessions.js";
import { buildPhotoPrompt, downloadTelegramFileAsDataUrl, selectLargestPhoto } from "./telegram-media.js";
import { handleVoiceMessage } from "./voice-handler.js";

// ─── Runtime dependency injection ──────────────────────────────────

export type Runtime = {
  hermes: HermesClient;
  sessions: SessionStore;
};

// Full context type with conversation support
type MyContext = Context & ConversationFlavor<Context> & { runtime: Runtime };

// ─── Bot factory ────────────────────────────────────────────────────

export function createBot(config: AppConfig, runtime: Runtime): Bot<MyContext> {
  const bot = new Bot<MyContext>(config.telegramBotToken);

  // Attach runtime to every context
  bot.use(async (ctx, next) => {
    ctx.runtime = runtime;
    await next();
  });

  // Global error handler
  bot.catch(async (err) => {
    const e = err.error ?? err;
    console.error("grammY handler error:", e instanceof Error ? e.message : String(e));
  });

  // Auth middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!isAllowedUser(userId, config.allowedUsers)) {
      await ctx.reply("⛔ You are not authorized to use this Hermes bot.");
      return;
    }
    await next();
  });

  // ─── Command handlers (native Telegram commands) ──────────────

  bot.command("start", async (ctx) => sendMainMenu(ctx));
  bot.command("help", async (ctx) => sendHelp(ctx));
  bot.command("menu", async (ctx) => sendMainMenu(ctx));

  bot.command("new", async (ctx) => {
    runtime.sessions.reset(sessionKey(ctx));
    await ctx.reply("🆕 Started a fresh Hermes conversation for this chat.");
  });

  bot.command("status", async (ctx) => {
    const health = await runtime.hermes.health();
    await ctx.reply(`<b>Hermes status</b>\n<pre>${escapeTelegramHtml(JSON.stringify(health, null, 2))}</pre>`, { parse_mode: "HTML" });
  });

  bot.command("stop", async (ctx) => {
    await forwardCommand(ctx, runtime, "/stop");
  });

  // Proxy slash-commands that Hermes handles
  for (const cmd of ["model", "cron", "platforms", "debug", "skills", "reasoning", "personality", "voice"] as const) {
    bot.command(cmd, async (ctx) => forwardCommand(ctx, runtime, `/${cmd}`));
  }

  // ─── Callback query router ────────────────────────────────────

  bot.callbackQuery(/^(nav|cmd|scene|back|action):/, async (ctx) => {
    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery("Unknown action");
      return;
    }

    const { kind, payload } = parsed;

    switch (kind) {
      case "nav":
      case "back": {
        const menu = getMenu(payload);
        if (!menu) {
          await ctx.answerCallbackQuery("Menu not found");
          return;
        }
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
          `<b>${escapeTelegramHtml(menu.title)}</b>${menu.description ? `\n${menu.description}` : ""}`,
          { parse_mode: "HTML", reply_markup: buildKeyboard(menu) },
        );
        return;
      }

      case "cmd": {
        await ctx.answerCallbackQuery();
        await forwardCommand(ctx, runtime, `/${payload}`);
        return;
      }

      case "scene": {
        await ctx.answerCallbackQuery(`Entering ${payload}...`);
        // Enter the conversation by name (registered in scenes.ts)
        await ctx.conversation.enter(payload);
        return;
      }

      case "action": {
        await ctx.answerCallbackQuery();
        await handleAction(ctx, runtime, payload);
        return;
      }
    }
  });

  // ─── Voice message handler ────────────────────────────────────

  bot.on("message:voice", async (ctx) => {
    if (!config.groqApiKey) {
      await ctx.reply("⚠ Voice transcription is not configured. Set GROQ_API_KEY in .env.");
      return;
    }

    const voice = ctx.message.voice;
    const fileId = voice.file_id;

    try {
      // Show that we're processing
      await ctx.replyWithChatAction("typing").catch(() => undefined);

      const result = await handleVoiceMessage(bot as any, fileId, {
        groqApiKey: config.groqApiKey,
        language: "ru", // hint for Whisper — Russian by default for this bot
      });

      if (!result.text) {
        await ctx.reply("🔇 Could not transcribe the voice message. It may be too short or unclear.");
        return;
      }

      // Show transcribed text to user
      const langTag = result.language ? ` [${result.language}]` : "";
      await ctx.reply(`🎙${langTag} ${result.text}`);

      // Forward transcribed text to Hermes
      await forwardMessage(ctx, runtime, result.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠ Voice transcription error: ${escapeTelegramHtml(message.slice(0, 300))}`, { parse_mode: "HTML" }).catch(() => undefined);
    }
  });

  // ─── Photo / UI reference handler ───────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const selectedPhoto = selectLargestPhoto(ctx.message.photo);
    if (!selectedPhoto) {
      await ctx.reply("⚠ Не вижу изображение в сообщении.");
      return;
    }

    try {
      await ctx.replyWithChatAction("typing").catch(() => undefined);
      await ctx.reply("🖼 Скрин получил, разбираю интерфейс…");

      const imageUrl = await downloadTelegramFileAsDataUrl({
        botToken: config.telegramBotToken,
        fileId: selectedPhoto.file_id,
        api: ctx.api,
      });
      const prompt = buildPhotoPrompt(ctx.message.caption);

      await sendTyping(ctx, () => forwardMessage(ctx, runtime, [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ]));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠ Ошибка обработки скриншота: ${escapeTelegramHtml(message.slice(0, 400))}`, { parse_mode: "HTML" }).catch(() => undefined);
    }
  });

  // ─── Fallback text handler ────────────────────────────────────

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    await sendTyping(ctx, () => forwardMessage(ctx, runtime, text));
  });

  return bot;
}

// ─── Register bot commands in Telegram UI ──────────────────────────

export async function registerBotCommands(bot: Bot<MyContext>): Promise<void> {
  await bot.api.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description })),
  );
}

// ─── Action dispatcher ─────────────────────────────────────────────

async function handleAction(
  ctx: MyContext,
  runtime: Runtime,
  action: string,
): Promise<void> {
  switch (action) {
    case "new": {
      runtime.sessions.reset(sessionKey(ctx));
      await ctx.reply("🆕 Started a fresh Hermes conversation for this chat.");
      return;
    }

    case "resume": {
      await forwardCommand(ctx, runtime, "/resume");
      return;
    }

    case "history": {
      await forwardCommand(ctx, runtime, "/history");
      return;
    }

    case "commands": {
      const text = BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`).join("\n");
      await ctx.reply(text);
      return;
    }

    case "help": {
      await sendHelp(ctx);
      return;
    }

    case "voice": {
      await forwardCommand(ctx, runtime, "/voice");
      return;
    }

    case "webhooks": {
      await forwardCommand(ctx, runtime, "/webhooks");
      return;
    }

    default:
      await ctx.reply(`Unknown action: ${action}`);
      return;
  }
}

// ─── Menu rendering ─────────────────────────────────────────────────

async function sendMainMenu(ctx: MyContext): Promise<void> {
  const menu = getMenu(MAIN_MENU_ID)!;
  await ctx.reply(
    `<b>${escapeTelegramHtml(menu.title)}</b>${menu.description ? `\n${menu.description}` : ""}`,
    { parse_mode: "HTML", reply_markup: buildKeyboard(menu) },
  );
}

async function sendHelp(ctx: MyContext): Promise<void> {
  const menu = getMenu(MAIN_MENU_ID)!;
  await ctx.reply(
    "<b>Hermes Telegram Sidecar</b>\n\n" +
    "Use /menu for the control panel, or send a message to chat with Hermes.\n" +
    "Tap any button to navigate.",
    { parse_mode: "HTML", reply_markup: buildKeyboard(menu) },
  );
}

// ─── Hermes message forwarding with streaming text ──────────────────

async function forwardCommand(ctx: MyContext, runtime: Runtime, command: string): Promise<void> {
  await sendTyping(ctx, () => forwardMessage(ctx, runtime, command));
}

async function forwardMessage(ctx: MyContext, runtime: Runtime, input: HermesResponsesInput): Promise<void> {
  const conversation = runtime.sessions.conversationFor(sessionKey(ctx));
  const chatId = ctx.chat?.id;

  // Streaming text state: track the message we're editing
  let streamingMsgId: number | undefined;
  let lastSentText = "";

  // Heartbeat callback
  const onHeartbeat = async (info: HeartbeatInfo) => {
    const text = formatHeartbeat(info);
    try {
      if (chatId) {
        await ctx.api.sendMessage(chatId, text, { parse_mode: "HTML" });
      }
    } catch {
      // Heartbeat delivery failure must not kill the request
    }
  };

  // Text chunk callback: edit the message as new text arrives
  const onTextChunk = async (chunk: TextChunk) => {
    if (!chatId) return;

    try {
      const displayText = chunk.fullText;

      // Check if text exceeds Telegram 4096 limit
      if (displayText.length > 4000) {
        // If we have an existing message, finalize it
        if (streamingMsgId) {
          // Message is already at limit, keep it
        }
        // Start new message with just the delta
        const msg = await ctx.api.sendMessage(chatId, chunk.delta.slice(0, 4000));
        streamingMsgId = msg.message_id;
        lastSentText = chunk.delta;
      } else if (streamingMsgId) {
        // Edit existing message
        await ctx.api.editMessageText(chatId, streamingMsgId, displayText);
        lastSentText = displayText;
      } else {
        // First chunk: create new message
        const msg = await ctx.api.sendMessage(chatId, displayText);
        streamingMsgId = msg.message_id;
        lastSentText = displayText;
      }
    } catch {
      // editMessageText can fail if content unchanged or message deleted
      // This is non-fatal
    }
  };

  try {
    const result = await runtime.hermes.sendMessage(
      { input, conversation },
      onHeartbeat,
      onTextChunk,
    );

    // If no text was streamed (e.g. empty or very short response), send normally
    const finalText = result.text || "Hermes returned an empty response.";

    if (streamingMsgId && lastSentText !== finalText) {
      // Update the streaming message with final text if it changed
      try {
        if (finalText.length <= 4000 && chatId) {
          await ctx.api.editMessageText(chatId, streamingMsgId, finalText);
        }
      } catch {
        // Non-fatal
      }
    } else if (!streamingMsgId) {
      // No streaming happened — send normally
      for (const chunk of splitTelegramMessage(finalText)) {
        await ctx.reply(chunk);
      }
    }
    // If streaming happened and lastSentText matches finalText, we're done — message already shown
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠ Hermes API error: ${escapeTelegramHtml(message.slice(0, 500))}`, { parse_mode: "HTML" }).catch(() => undefined);
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

async function sendTyping(ctx: MyContext, fn: () => Promise<void>): Promise<void> {
  await ctx.replyWithChatAction("typing").catch(() => undefined);
  await fn();
}

function sessionKey(ctx: MyContext): { chatId: string; threadId?: string } {
  const chatId = String(ctx.chat?.id ?? ctx.from?.id ?? "unknown");
  const message = ctx.message ?? ctx.callbackQuery?.message;
  const maybeThreadId = message && "message_thread_id" in message ? message.message_thread_id : undefined;
  return maybeThreadId == null ? { chatId } : { chatId, threadId: String(maybeThreadId) };
}
