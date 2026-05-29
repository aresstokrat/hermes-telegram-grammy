// ─── Hermes API client with streaming support & heartbeat ───
//
// Three streaming features:
//   1. Heartbeat: counts SSE output_item transitions, sends progress every N
//   2. Text streaming: forwards text deltas to Telegram as they arrive
//   3. Non-streaming: for health checks etc.
//
// Text streaming protocol:
//   - On first text delta: creates a new message in Telegram
//   - On subsequent deltas: edits that message, appending new text
//   - Flush every FLUSH_INTERVAL_MS or FLUSH_CHAR_LIMIT chars
//   - If message exceeds Telegram 4096 char limit, start a new message

import { InlineKeyboard } from "grammy";
import { splitTelegramMessage, escapeTelegramHtml } from "./format.js";

// ─── Types ────────────────────────────────────────────────────────

export type HermesClientOptions = {
  baseUrl: string;
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type HermesTextPart = { type: "text"; text: string };
export type HermesImagePart = {
  type: "image_url" | "input_image";
  image_url: string | { url: string; detail?: string };
  detail?: string;
};
export type HermesContentPart = HermesTextPart | HermesImagePart;
export type HermesMessageInput = {
  role?: "user" | "assistant" | "system" | string;
  content: string | HermesContentPart[];
};
export type HermesResponsesInput = string | Array<string | HermesMessageInput>;

export type SendMessageInput = {
  input: HermesResponsesInput;
  conversation: string;
  instructions?: string;
};

export type SendMessageResult = {
  id?: string;
  text: string;
  raw: unknown;
};

export type HeartbeatInfo = {
  taskSummary: string;
  elapsedSec: number;
  transitionCount: number;
};

export type HeartbeatCallback = (info: HeartbeatInfo) => Promise<void>;

export type TextChunk = {
  /** Accumulated full text so far */
  fullText: string;
  /** Just the new delta since last callback */
  delta: string;
};

export type TextChunkCallback = (chunk: TextChunk) => Promise<void>;

// ─── Constants ────────────────────────────────────────────────────

/** How many output_item.added events between heartbeats */
const HEARTBEAT_EVERY = 5;

/** Max characters of user input to show in heartbeat summary */
const TASK_SUMMARY_MAX_LEN = 40;

/** Flush text to Telegram after this many ms of no new deltas */
const FLUSH_INTERVAL_MS = 400;

/** Or flush after accumulating this many new chars */
const FLUSH_CHAR_LIMIT = 300;

// ─── Client class ─────────────────────────────────────────────────

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
    this.timeoutMs = options.timeoutMs ?? 600_000; // 10 min default
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async sendMessage(
    input: SendMessageInput,
    onHeartbeat?: HeartbeatCallback,
    onTextChunk?: TextChunkCallback,
  ): Promise<SendMessageResult> {
    const taskSummary = summarizeTask(input.input);

    // Use streaming for better heartbeat control + text streaming
    return this.sendStreaming(input, taskSummary, onHeartbeat, onTextChunk);
  }

  /** Non-streaming request for health checks etc. */
  async health(): Promise<unknown> {
    return this.requestJson("/health/detailed", { method: "GET" });
  }

  // ─── Streaming implementation ──────────────────────────────────

  private async sendStreaming(
    input: SendMessageInput,
    taskSummary: string,
    onHeartbeat?: HeartbeatCallback,
    onTextChunk?: TextChunkCallback,
  ): Promise<SendMessageResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startTime = Date.now();

    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/responses`,
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input: input.input,
            instructions: input.instructions,
            conversation: input.conversation,
            stream: true,
            store: true,
          }),
        },
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Hermes API ${response.status}: ${text}`);
      }

      // Parse SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let transitionCount = 0;
      let lastHeartbeatAt = 0;
      let fullJson: unknown = null;
      let responseId: string | undefined;

      // Text streaming state
      let accumulatedText = "";
      let unflushedText = "";
      let lastFlushTime = 0;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const flushText = async () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!onTextChunk || unflushedText.length === 0) return;
        const delta = unflushedText;
        unflushedText = "";
        lastFlushTime = Date.now();
        try {
          await onTextChunk({ fullText: accumulatedText, delta });
        } catch {
          // Text chunk delivery failure must not kill the main request
        }
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushText().catch(() => {});
        }, FLUSH_INTERVAL_MS);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buf.split("\n");
        buf = lines.pop()!; // keep incomplete line

        for (const line of lines) {
          if (line.startsWith("event: response.completed")) {
            // Next data line has the full response
          }

          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              const eventType = data.type ?? "";

              // Track response ID
              if (data.response?.id) {
                responseId = data.response.id;
              }

              // Count transitions (output_item.added = new agent step)
              if (eventType === "response.output_item.added") {
                transitionCount++;

                // Heartbeat check
                if (
                  onHeartbeat &&
                  transitionCount - lastHeartbeatAt >= HEARTBEAT_EVERY
                ) {
                  lastHeartbeatAt = transitionCount;
                  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
                  try {
                    await onHeartbeat({
                      taskSummary,
                      elapsedSec,
                      transitionCount,
                    });
                  } catch {
                    // Heartbeat failure must not kill the main request
                  }
                }
              }

              // Stream text deltas
              if (eventType === "response.output_text.delta" && data.delta) {
                accumulatedText += data.delta;
                unflushedText += data.delta;

                // Flush if over char limit
                if (unflushedText.length >= FLUSH_CHAR_LIMIT) {
                  await flushText();
                } else {
                  scheduleFlush();
                }
              }

              // Capture completed response
              if (eventType === "response.completed") {
                fullJson = data.response ?? data;
              }
            } catch {
              // Malformed SSE data line — skip
            }
          }
        }
      }

      // Final flush for any remaining text
      await flushText();

      // Extract text from the completed response (use accumulated if available)
      const text = accumulatedText || extractResponseText(fullJson);
      return {
        id: responseId,
        text: text || "Hermes returned an empty response.",
        raw: fullJson,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Non-streaming helper ──────────────────────────────────────

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

// ─── Response text extraction ────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────

function summarizeTask(input: HermesResponsesInput): string {
  if (Array.isArray(input)) {
    const last = input[input.length - 1];
    if (typeof last === "string") return summarizeTask(last);
    const content = last?.content;
    if (typeof content === "string") return summarizeTask(content);
    if (Array.isArray(content)) {
      const textPart = content.find((part) => part.type === "text" && part.text.trim());
      if (textPart?.type === "text") return summarizeTask(textPart.text);
      if (content.some((part) => part.type === "image_url" || part.type === "input_image")) return "[image]";
    }
    return "[message]";
  }
  // For slash commands, use the command itself
  if (input.startsWith("/")) {
    const spaceIdx = input.indexOf(" ");
    return spaceIdx === -1 ? input : input.slice(0, spaceIdx);
  }
  // For regular messages, truncate
  const clean = input.replace(/\n/g, " ").trim();
  if (clean.length <= TASK_SUMMARY_MAX_LEN) return clean;
  return clean.slice(0, TASK_SUMMARY_MAX_LEN - 1) + "…";
}

export function formatHeartbeat(info: HeartbeatInfo): string {
  const mins = Math.floor(info.elapsedSec / 60);
  const secs = info.elapsedSec % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return `⏳ <b>${escapeTelegramHtml(info.taskSummary)}</b> — ${timeStr}, step ${info.transitionCount}`;
}
