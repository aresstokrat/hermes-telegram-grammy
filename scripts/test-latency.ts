// Latency breakdown test v2
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envText = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const apiKeyLine = envText.split("\n").find(l => l.startsWith("HERMES_API_KEY="));
const apiKey = apiKeyLine ? apiKeyLine.split("=").slice(1).join("=").trim() : "";

async function testLatency(label: string, input: string) {
  const t0 = Date.now();
  
  const resp = await fetch("http://127.0.0.1:8642/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "hermes-agent",
      input,
      stream: true,
      store: false,
    }),
  });

  let firstByte: number | null = null;
  let firstTextDelta: number | null = null;
  let lastEvent: number | null = null;
  let outputItems = 0;
  let textLen = 0;
  const eventTypes: Record<string, number> = {};

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    if (firstByte === null) firstByte = Date.now() - t0;
    
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const d = JSON.parse(line.slice(6));
        lastEvent = Date.now() - t0;
        eventTypes[d.type] = (eventTypes[d.type] || 0) + 1;
        
        if (d.type === "response.output_item.added") outputItems++;
        if (d.type === "response.output_text.delta") {
          if (firstTextDelta === null) firstTextDelta = Date.now() - t0;
          textLen += (d.delta || "").length;
        }
      } catch {}
    }
  }

  const total = Date.now() - t0;
  console.log("\n=== " + label + " ===");
  console.log("Input: \"" + input + "\"");
  console.log("First byte:        " + firstByte + " ms");
  console.log("First text delta:  " + (firstTextDelta ?? "N/A") + " ms");
  console.log("Total:             " + total + " ms");
  console.log("Output items:      " + outputItems);
  console.log("Text length:       " + textLen + " chars");
  console.log("Event types:       " + JSON.stringify(eventTypes));
}

async function main() {
  await testLatency("Simple greeting", "Say hello in one word");
  await testLatency("Tool command", "/status");
  await testLatency("Complex command", "/platforms");
}

main().catch(e => console.error(e));
