# hermes-telegram-grammy

A native Telegram chat sidecar for [Hermes Agent](https://github.com/NousResearch/hermes-agent), built with [grammY](https://github.com/grammyjs/grammY).

It is **not** a Telegram Mini App and it does **not** fork Hermes. It gives Hermes a friendlier Telegram UX directly inside the chat: slash commands, Telegram bot menu, and inline button palettes.

## Status

Early MVP. The first goal is a safe sidecar that talks to Hermes through the API Server. It is ready to run locally, but not yet full parity with the native Hermes Telegram adapter.

## Architecture

```text
Telegram chat → grammY sidecar → Hermes API Server → Hermes Agent
```

## Features

- `/start`, `/help`, `/menu`, `/new`, `/status`, `/commands`, `/model`, `/cron`, `/platforms`, `/debug`, `/stop`
- Inline command palette with callback buttons
- Telegram `setMyCommands` registration
- Per-chat conversation keys for Hermes API Server
- Telegram allowlist via `TELEGRAM_ALLOWED_USERS`
- Message splitting for Telegram limits
- OpenAI Responses API client for Hermes

## Hermes setup

Enable the API server and avoid running two Telegram pollers with the same bot token.

```bash
hermes config set platforms.api_server.enabled true
hermes config set platforms.telegram.enabled false
hermes gateway restart
```

Alternatively set in `~/.hermes/.env`:

```bash
API_SERVER_ENABLED=true
API_SERVER_KEY=change-me-local-dev
```

## Sidecar setup

Requires Node.js `>=18.19`.

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## Environment

| Variable | Required | Description |
|---|---:|---|
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from @BotFather |
| `HERMES_API_BASE_URL` | no | Hermes API server base, defaults to `http://127.0.0.1:8642` |
| `HERMES_API_KEY` | yes | Bearer token matching Hermes `API_SERVER_KEY` |
| `TELEGRAM_ALLOWED_USERS` | recommended | Comma-separated Telegram user IDs; empty means deny all; `*` allows all |
| `HERMES_CONVERSATION_PREFIX` | no | Prefix for stable Hermes conversation IDs |
| `HERMES_REQUEST_TIMEOUT_MS` | no | Request timeout, default 180000 |

## Telegram UX

Use `/menu` to open the inline command palette:

```text
Session: New, Status, Stop
Ops:     Model, Cron, Platforms
Help:    Debug, Commands, Help
```

Buttons route to the same command handlers as slash commands, so the UI stays thin and Hermes remains the backend.

## Current limitations

- Normal chat uses Hermes `/v1/responses` named conversations.
- `/model`, `/cron`, `/platforms`, and `/debug` are forwarded to Hermes as slash-command text.
- `/stop` is a placeholder until Runs API stop support is wired in.
- Media/voice/document forwarding and approval callbacks are not implemented yet.
- Do not run this sidecar and the native Hermes Telegram adapter against the same bot token at the same time.

## Docker

```bash
cp .env.example .env
docker compose -f docker-compose.example.yml up --build
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

CI runs `npm run ci`, which performs typecheck, build, and tests.

## License

MIT
