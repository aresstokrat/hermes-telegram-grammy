export function escapeTelegramHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function splitTelegramMessage(input: string, limit = 4096): string[] {
  if (limit <= 0) throw new Error("limit must be positive");
  if (input.length <= limit) return [input];

  const chunks: string[] = [];
  let remaining = input;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
