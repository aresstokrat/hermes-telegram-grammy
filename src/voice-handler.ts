// ─── Voice message handler: download .ogg → Groq Whisper → text ───
//
// Flow:
//   1. Bot receives voice message
//   2. Download .ogg file via Telegram Bot API file endpoint
//   3. Send .ogg to Groq Whisper API (whisper-large-v3)
//   4. Return transcribed text
//
// Groq accepts .ogg natively — no conversion needed.

import type { Bot, Context } from "grammy";

// ─── Types ────────────────────────────────────────────────────────

export type VoiceTranscriptionResult = {
  text: string;
  language?: string;
  duration?: number;
};

// ─── Download voice file from Telegram ────────────────────────────

async function downloadVoiceFile(
  bot: Bot<Context>,
  fileId: string,
): Promise<Buffer> {
  // Get file path from Telegram
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Telegram did not return a file_path for the voice message");
  }

  // Download file content
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download voice file: ${response.status} ${await response.text()}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Send to Groq Whisper API ──────────────────────────────────────

async function transcribeWithGroq(
  audioBuffer: Buffer,
  apiKey: string,
  language?: string,
): Promise<VoiceTranscriptionResult> {
  const formData = new FormData();
  // @ts-expect-error Node Buffer / web Blob type mismatch — works at runtime
  const blob = new Blob([audioBuffer], { type: "audio/ogg" });
  formData.append("file", blob, "voice.ogg");
  formData.append("model", "whisper-large-v3");
  formData.append("response_format", "verbose_json");

  if (language) {
    formData.append("language", language);
  }

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API ${response.status}: ${errorText}`);
  }

  const result = await response.json() as {
    text: string;
    language?: string;
    duration?: number;
  };

  return {
    text: result.text?.trim() || "",
    language: result.language,
    duration: result.duration,
  };
}

// ─── Public API ───────────────────────────────────────────────────

export type VoiceHandlerConfig = {
  groqApiKey: string;
  language?: string; // hint for Whisper, e.g. "ru" for Russian
};

export async function handleVoiceMessage(
  bot: Bot<Context>,
  fileId: string,
  config: VoiceHandlerConfig,
): Promise<VoiceTranscriptionResult> {
  // Step 1: Download
  const audioBuffer = await downloadVoiceFile(bot, fileId);

  // Step 2: Transcribe
  const result = await transcribeWithGroq(audioBuffer, config.groqApiKey, config.language);

  return result;
}
