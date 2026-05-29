import { parseAllowedUsers } from "./auth.js";

export type AppConfig = {
  telegramBotToken: string;
  hermesApiBaseUrl: string;
  hermesApiKey: string;
  allowedUsers: Set<string>;
  conversationPrefix: string;
  requestTimeoutMs: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const telegramBotToken = requireEnv(env, "TELEGRAM_BOT_TOKEN");
  const hermesApiBaseUrl = env.HERMES_API_BASE_URL || "http://127.0.0.1:8642";
  const hermesApiKey = requireEnv(env, "HERMES_API_KEY");
  const requestTimeoutMs = Number(env.HERMES_REQUEST_TIMEOUT_MS || "180000");

  return {
    telegramBotToken,
    hermesApiBaseUrl,
    hermesApiKey,
    allowedUsers: parseAllowedUsers(env.TELEGRAM_ALLOWED_USERS),
    conversationPrefix: env.HERMES_CONVERSATION_PREFIX || "telegram",
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : 180_000,
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
