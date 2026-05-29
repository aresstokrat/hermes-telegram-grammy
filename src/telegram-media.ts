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

  const contentType = response.headers.get("content-type") || guessImageMimeType(file.file_path);
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Telegram file is not an image: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function photoScore(photo: TelegramPhotoSize): number {
  return photo.width * photo.height + (photo.file_size ?? 0) / 1000;
}

function guessImageMimeType(path: string): string {
  const lowered = path.toLowerCase();
  if (lowered.endsWith(".png")) return "image/png";
  if (lowered.endsWith(".webp")) return "image/webp";
  if (lowered.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}
