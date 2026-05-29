#!/usr/bin/env node
import "dotenv/config";
import { createBot, registerBotCommands } from "./bot.js";
import { loadConfig } from "./config.js";
import { HermesClient } from "./hermes-client.js";
import { SessionStore } from "./sessions.js";
import { conversations, conversationsList } from "./scenes.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const hermes = new HermesClient({
    baseUrl: config.hermesApiBaseUrl,
    apiKey: config.hermesApiKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const sessions = new SessionStore(config.conversationPrefix);
  const bot = createBot(config, { hermes, sessions });

  let shutdownStarted = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    console.warn(`[lifecycle] received ${signal}; stopping Telegram long polling gracefully`);
    try {
      await bot.stop();
      console.warn(`[lifecycle] bot stopped after ${signal}`);
      process.exit(0);
    } catch (error) {
      console.error(`[lifecycle] failed to stop bot after ${signal}:`, error);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    console.error("[fatal] uncaught exception:", error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[fatal] unhandled rejection:", reason);
    process.exit(1);
  });

  // Register grammY conversations (model-picker, cron-manager, etc.)
  bot.use(conversations());
  for (const conv of conversationsList) {
    bot.use(conv);
  }

  // Register command palette in Telegram UI
  await registerBotCommands(bot);

  console.log("🤖 Hermes Telegram sidecar starting...");
  await bot.start({ drop_pending_updates: true });
}

main().catch((error) => {
  console.error("[fatal] startup failed:", error);
  process.exit(1);
});
