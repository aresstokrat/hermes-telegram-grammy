import { Bot, Context, InlineKeyboard } from "grammy";
import { isAllowedUser } from "./auth.js";
import { AppConfig } from "./config.js";
import { escapeTelegramHtml, splitTelegramMessage } from "./format.js";
import { HermesClient } from "./hermes-client.js";
import { BOT_COMMANDS, commandFromCallback, mainMenuRows } from "./menus.js";
import { SessionStore } from "./sessions.js";

export type Runtime = {
  hermes: HermesClient;
  sessions: SessionStore;
};

export function createBot(config: AppConfig, runtime: Runtime): Bot<Context> {
  const bot = new Bot<Context>(config.telegramBotToken);

  bot.catch(async (err) => {
    const e = err.error ?? err;
    console.error("grammY handler error:", e instanceof Error ? e.message : String(e));
  });

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!isAllowedUser(userId, config.allowedUsers)) {
      await ctx.reply("⛔ You are not authorized to use this Hermes bot.");
      return;
    }
    await next();
  });

  bot.command("start", async (ctx) => sendHelp(ctx));
  bot.command("help", async (ctx) => sendHelp(ctx));
  bot.command("menu", async (ctx) => sendMenu(ctx));
  bot.command("new", async (ctx) => {
    runtime.sessions.reset(sessionKey(ctx));
    await ctx.reply("🆕 Started a fresh Hermes conversation for this Telegram chat.", { reply_markup: buildMainMenuKeyboard() });
  });
  bot.command("status", async (ctx) => sendStatus(ctx, runtime.hermes));
  bot.command("commands", async (ctx) => sendCommands(ctx));
  bot.command("stop", async (ctx) => ctx.reply("⏹ Stop via Runs API is not wired in this MVP yet. Use Hermes native /stop if needed."));

  for (const command of ["model", "cron", "platforms", "debug"] as const) {
    bot.command(command, async (ctx) => forwardSlashCommand(ctx, runtime, `/${command}`));
  }

  bot.callbackQuery(/^cmd:/, async (ctx) => {
    const command = commandFromCallback(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (!command) return;
    await dispatchCommand(ctx, runtime, command);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    await sendTyping(ctx, () => forwardMessage(ctx, runtime, text));
  });

  return bot;
}

export async function registerBotCommands(bot: Bot<Context>): Promise<void> {
  await bot.api.setMyCommands(BOT_COMMANDS.map(({ command, description }) => ({ command, description })));
}

function buildMainMenuKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const row of mainMenuRows()) {
    for (const button of row) keyboard.text(button.text, button.callbackData);
    keyboard.row();
  }
  return keyboard;
}

async function sendHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    "<b>Hermes Telegram grammY sidecar</b>\n\nUse /menu for buttons, or just send a message to Hermes.",
    { parse_mode: "HTML", reply_markup: buildMainMenuKeyboard() },
  );
}

async function sendMenu(ctx: Context): Promise<void> {
  await ctx.reply("Choose a Hermes action:", { reply_markup: buildMainMenuKeyboard() });
}

async function sendCommands(ctx: Context): Promise<void> {
  const text = BOT_COMMANDS.map((command) => `/${command.command} — ${command.description}`).join("\n");
  await ctx.reply(text);
}

async function sendStatus(ctx: Context, hermes: HermesClient): Promise<void> {
  const health = await hermes.health();
  await ctx.reply(`<b>Hermes status</b>\n<pre>${escapeTelegramHtml(JSON.stringify(health, null, 2))}</pre>`, { parse_mode: "HTML" });
}

async function dispatchCommand(ctx: Context, runtime: Runtime, command: string): Promise<void> {
  switch (command) {
    case "help": return sendHelp(ctx);
    case "menu": return sendMenu(ctx);
    case "commands": return sendCommands(ctx);
    case "new":
      runtime.sessions.reset(sessionKey(ctx));
      await ctx.reply("🆕 Started a fresh Hermes conversation for this Telegram chat.", { reply_markup: buildMainMenuKeyboard() });
      return;
    case "status": return sendStatus(ctx, runtime.hermes);
    case "stop":
      await ctx.reply("⏹ Stop via Runs API is not wired in this MVP yet. Use Hermes native /stop if needed.");
      return;
    case "model":
    case "cron":
    case "platforms":
    case "debug":
      return forwardSlashCommand(ctx, runtime, `/${command}`);
    default:
      await ctx.reply(`Unknown command: ${command}`);
      return;
  }
}

async function forwardSlashCommand(ctx: Context, runtime: Runtime, command: string): Promise<void> {
  await sendTyping(ctx, () => forwardMessage(ctx, runtime, command));
}

async function forwardMessage(ctx: Context, runtime: Runtime, input: string): Promise<void> {
  const conversation = runtime.sessions.conversationFor(sessionKey(ctx));
  try {
    const result = await runtime.hermes.sendMessage({ input, conversation });
    const text = result.text || "Hermes returned an empty response.";
    for (const chunk of splitTelegramMessage(text)) {
      await ctx.reply(chunk);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`⚠ Hermes API error: ${escapeTelegramHtml(message.slice(0, 500))}`, { parse_mode: "HTML" }).catch(() => undefined);
  }
}

async function sendTyping(ctx: Context, fn: () => Promise<void>): Promise<void> {
  await ctx.replyWithChatAction("typing").catch(() => undefined);
  await fn();
}

function sessionKey(ctx: Context): { chatId: string; threadId?: string } {
  const chatId = String(ctx.chat?.id ?? ctx.from?.id ?? "unknown");
  const message = ctx.message ?? ctx.callbackQuery?.message;
  const maybeThreadId = message && "message_thread_id" in message ? message.message_thread_id : undefined;
  return maybeThreadId == null ? { chatId } : { chatId, threadId: String(maybeThreadId) };
}
