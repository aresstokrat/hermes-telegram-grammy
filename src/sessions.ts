export type TelegramSessionKey = {
  chatId: string | number;
  threadId?: string | number | null;
};

export class SessionStore {
  private generations = new Map<string, number>();

  constructor(private readonly prefix = "telegram") {}

  conversationFor(key: TelegramSessionKey): string {
    const base = this.baseKey(key);
    const generation = this.generations.get(base) ?? 0;
    return `${base}:${generation}`;
  }

  reset(key: TelegramSessionKey): string {
    const base = this.baseKey(key);
    const next = (this.generations.get(base) ?? 0) + 1;
    this.generations.set(base, next);
    return `${base}:${next}`;
  }

  private baseKey(key: TelegramSessionKey): string {
    const chatId = String(key.chatId);
    const threadId = key.threadId == null ? "" : String(key.threadId);
    return threadId ? `${this.prefix}:${chatId}:thread:${threadId}` : `${this.prefix}:${chatId}`;
  }
}
