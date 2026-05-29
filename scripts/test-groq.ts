#!/usr/bin/env node
// Quick test: Groq Whisper API with a generated .ogg file

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config({ path: path.join(import.meta.dirname, "..", ".env") });

const groqKey = process.env.GROQ_API_KEY;
if (!groqKey) { console.error("GROQ_API_KEY not set"); process.exit(1); }

// Generate a test .ogg with ffmpeg
const testFile = "/tmp/test-whisper-voice.ogg";
try {
  execSync(
    `ffmpeg -y -f lavfi -i sine=frequency=440:duration=2 -ar 16000 -ac 1 -c:a libopus ${testFile}`,
    { stdio: "pipe" }
  );
} catch {
  // fallback: raw ogg
  execSync(`sox -n ${testFile} synth 2 sine 440 rate 16000`, { stdio: "pipe" });
}

const audioBuffer = fs.readFileSync(testFile);
console.log(`Test audio: ${audioBuffer.length} bytes`);

// Send to Groq
const blob = new Blob([audioBuffer], { type: "audio/ogg" });
const formData = new FormData();
formData.append("file", blob, "voice.ogg");
formData.append("model", "whisper-large-v3");
formData.append("response_format", "verbose_json");
formData.append("language", "ru");

const t0 = Date.now();
const resp = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
  method: "POST",
  headers: { Authorization: `Bearer ${groqKey}` },
  body: formData,
});
const elapsed = Date.now() - t0;

const result = await resp.json();
console.log(`Status: ${resp.status} in ${elapsed}ms`);
console.log(JSON.stringify(result, null, 2));
