export type BotCommandDefinition = {
  command: string;
  description: string;
};

export type MenuButtonDefinition = {
  text: string;
  command: string;
  callbackData: string;
};

export const BOT_COMMANDS: BotCommandDefinition[] = [
  { command: "start", description: "Start the Hermes Telegram sidecar" },
  { command: "help", description: "Show help" },
  { command: "menu", description: "Open button command palette" },
  { command: "new", description: "Start a fresh Hermes conversation" },
  { command: "status", description: "Show Hermes API status" },
  { command: "commands", description: "List available commands" },
  { command: "model", description: "Ask Hermes to show/change model" },
  { command: "cron", description: "Ask Hermes to manage cron jobs" },
  { command: "platforms", description: "Ask Hermes to show platform status" },
  { command: "debug", description: "Ask Hermes for debug information" },
  { command: "stop", description: "Stop or interrupt current work" },
];

export function callbackDataFor(command: string): string {
  return `cmd:${command}`;
}

export function mainMenuRows(): MenuButtonDefinition[][] {
  return [
    [
      { text: "🆕 New", command: "new", callbackData: callbackDataFor("new") },
      { text: "📊 Status", command: "status", callbackData: callbackDataFor("status") },
      { text: "⏹ Stop", command: "stop", callbackData: callbackDataFor("stop") },
    ],
    [
      { text: "🧠 Model", command: "model", callbackData: callbackDataFor("model") },
      { text: "⏱ Cron", command: "cron", callbackData: callbackDataFor("cron") },
      { text: "🌉 Platforms", command: "platforms", callbackData: callbackDataFor("platforms") },
    ],
    [
      { text: "🧪 Debug", command: "debug", callbackData: callbackDataFor("debug") },
      { text: "📚 Commands", command: "commands", callbackData: callbackDataFor("commands") },
      { text: "❔ Help", command: "help", callbackData: callbackDataFor("help") },
    ],
  ];
}

export function commandFromCallback(data: string | undefined): string | null {
  if (!data?.startsWith("cmd:")) return null;
  const command = data.slice(4).trim();
  if (!command) return null;
  return command;
}
