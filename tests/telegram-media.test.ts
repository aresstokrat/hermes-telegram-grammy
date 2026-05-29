import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPhotoPrompt,
  downloadTelegramFileAsDataUrl,
  selectLargestPhoto,
} from "../src/telegram-media.js";

describe("telegram photo helpers", () => {
  it("selects the largest Telegram photo size", () => {
    const selected = selectLargestPhoto([
      { file_id: "small", width: 160, height: 90 },
      { file_id: "large", width: 1280, height: 720 },
      { file_id: "medium", width: 640, height: 360 },
    ]);

    assert.equal(selected?.file_id, "large");
  });

  it("builds a UI-reference prompt that preserves caption", () => {
    const prompt = buildPhotoPrompt("Хочу такое меню: Code / Logs / Status");

    assert.match(prompt, /скриншот/i);
    assert.match(prompt, /UI-reference/i);
    assert.match(prompt, /Code \/ Logs \/ Status/);
  });

  it("downloads a Telegram file as an image data URL", async () => {
    const fetchCalls: string[] = [];
    const dataUrl = await downloadTelegramFileAsDataUrl({
      botToken: "123:secret-token",
      fileId: "photo_file_id",
      api: {
        getFile: async (fileId) => {
          assert.equal(fileId, "photo_file_id");
          return { file_path: "photos/file_1.jpg" };
        },
      },
      fetchImpl: async (url) => {
        fetchCalls.push(String(url));
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        });
      },
    });

    assert.equal(fetchCalls[0], "https://api.telegram.org/file/bot123:secret-token/photos/file_1.jpg");
    assert.equal(dataUrl, "data:image/jpeg;base64,AQID");
  });

  it("treats Telegram application/octet-stream downloads as images when file path has an image extension", async () => {
    const dataUrl = await downloadTelegramFileAsDataUrl({
      botToken: "123:secret-token",
      fileId: "photo_file_id",
      api: {
        getFile: async () => ({ file_path: "photos/file_2.jpg" }),
      },
      fetchImpl: async () => new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    });

    assert.equal(dataUrl, "data:image/jpeg;base64,BAUG");
  });

  it("treats Telegram application/octet-stream downloads as images when bytes have an image signature", async () => {
    const dataUrl = await downloadTelegramFileAsDataUrl({
      botToken: "123:secret-token",
      fileId: "photo_file_id",
      api: {
        getFile: async () => ({ file_path: "photos/file_without_extension" }),
      },
      fetchImpl: async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    });

    assert.equal(dataUrl, "data:image/jpeg;base64,/9j/4A==");
  });

  it("rejects non-image content types even when the file path looks like an image", async () => {
    await assert.rejects(
      () => downloadTelegramFileAsDataUrl({
        botToken: "123:secret-token",
        fileId: "photo_file_id",
        api: {
          getFile: async () => ({ file_path: "photos/file_3.jpg" }),
        },
        fetchImpl: async () => new Response("not an image", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      }),
      /Telegram file is not an image: text\/plain/,
    );
  });
});
