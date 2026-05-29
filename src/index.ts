#!/usr/bin/env node
import "dotenv/config";
import { createBot, registerBotCommands } from "./bot.js";
import { loadConfig } from "./config.js";
import { HermesClient } from "./hermes-client.js";
import { SessionStore } from "./sessions.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const hermes = new HermesClient({
    baseUrl: config.hermesApiBaseUrl,
    apiKey: config.hermesApiKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const sessions = new SessionStore(config.conversationPrefix);
  const bot = createBot(config, { hermes, sessions });

  await registerBotCommands(bot);
  await bot.start({ drop_pending_updates: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
