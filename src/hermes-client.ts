export type HermesClientOptions = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type SendMessageInput = {
  input: string;
  conversation: string;
  instructions?: string;
};

export type SendMessageResult = {
  id?: string;
  text: string;
  raw: unknown;
};

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HermesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "hermes-agent";
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const json = await this.requestJson("/v1/responses", {
      method: "POST",
      body: JSON.stringify({
        model: this.model,
        input: input.input,
        instructions: input.instructions,
        conversation: input.conversation,
        store: true,
      }),
    });

    return {
      id: typeof (json as { id?: unknown }).id === "string" ? (json as { id: string }).id : undefined,
      text: extractResponseText(json),
      raw: json,
    };
  }

  async health(): Promise<unknown> {
    return this.requestJson("/health/detailed", { method: "GET" });
  }

  private async requestJson(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...(init.headers ?? {}),
        },
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Hermes API ${response.status}: ${text}`);
      }
      return text ? JSON.parse(text) : {};
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function extractResponseText(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) return "";
  const record = raw as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = record.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const item of output) {
      if (typeof item !== "object" || item === null) continue;
      const itemRecord = item as Record<string, unknown>;
      const content = itemRecord.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part !== "object" || part === null) continue;
        const partRecord = part as Record<string, unknown>;
        const text = partRecord.text;
        if (typeof text === "string") parts.push(text);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }

  const choices = record.choices;
  if (Array.isArray(choices)) {
    const first = choices[0] as { message?: { content?: unknown } } | undefined;
    if (typeof first?.message?.content === "string") return first.message.content;
  }

  return "";
}
