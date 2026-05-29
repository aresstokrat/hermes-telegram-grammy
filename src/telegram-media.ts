import { Buffer } from "node:buffer";

export type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
};

export type TelegramFile = {
  file_path?: string;
};

export type TelegramFileApi = {
  getFile(fileId: string): Promise<TelegramFile>;
};

export type DownloadTelegramFileOptions = {
  botToken: string;
  fileId: string;
  api: TelegramFileApi;
  fetchImpl?: typeof fetch;
};

export function selectLargestPhoto(photos: readonly TelegramPhotoSize[] | undefined): TelegramPhotoSize | undefined {
  if (!photos || photos.length === 0) return undefined;
  return [...photos].sort((a, b) => photoScore(b) - photoScore(a))[0];
}

export function buildPhotoPrompt(caption?: string): string {
  const trimmedCaption = caption?.trim();
  const userContext = trimmedCaption
    ? `\n\nКомментарий пользователя к скриншоту:\n${trimmedCaption}`
    : "\n\nКомментария пользователя к скриншоту нет.";

  return [
    "Пользователь отправил скриншот интерфейса как UI-reference для Telegram/grammY sidecar.",
    "Разбери скриншот и верни короткую UX Map:",
    "- какие экраны/блоки видны;",
    "- какие кнопки и действия нужны;",
    "- какая вложенность меню предполагается;",
    "- что можно сделать нативно в Telegram через grammY, а что нельзя без Mini App;",
    "- предложи следующий implementation route.",
    userContext,
  ].join("\n");
}

export async function downloadTelegramFileAsDataUrl(options: DownloadTelegramFileOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const file = await options.api.getFile(options.fileId);
  if (!file.file_path) {
    throw new Error("Telegram getFile did not return file_path");
  }

  const url = `https://api.telegram.org/file/bot${options.botToken}/${file.file_path}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Telegram file download failed: ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
  }

  const contentType = normalizeMimeType(response.headers.get("content-type"));
  const bytes = Buffer.from(await response.arrayBuffer());
  const realContentType = resolveImageMimeType({
    headerContentType: contentType,
    filePath: file.file_path,
    bytes,
  });
  if (!realContentType) {
    throw new Error(`Telegram file is not an image: ${contentType || "unknown"}`);
  }

  return `data:${realContentType};base64,${bytes.toString("base64")}`;
}

function photoScore(photo: TelegramPhotoSize): number {
  return photo.width * photo.height + (photo.file_size ?? 0) / 1000;
}

function resolveImageMimeType(options: {
  headerContentType?: string;
  filePath: string;
  bytes: Buffer;
}): string | undefined {
  if (options.headerContentType?.startsWith("image/")) return options.headerContentType;
  if (options.headerContentType && !isAmbiguousBinaryMimeType(options.headerContentType)) return undefined;
  return guessImageMimeType(options.filePath) ?? sniffImageMimeType(options.bytes);
}

function normalizeMimeType(contentType: string | null): string | undefined {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function isAmbiguousBinaryMimeType(contentType: string): boolean {
  return contentType === "application/octet-stream" || contentType === "binary/octet-stream";
}

function guessImageMimeType(path: string): string | undefined {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) return "image/jpeg";
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  return undefined;
}

function sniffImageMimeType(bytes: Buffer): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6) {
    const gifHeader = bytes.subarray(0, 6).toString("ascii");
    if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}
