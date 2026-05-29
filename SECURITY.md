# Security Policy

This project is a Telegram frontend for a local or self-hosted Hermes Agent API server.

## Secrets

Never commit real values for:

- `TELEGRAM_BOT_TOKEN`
- `HERMES_API_KEY`
- `API_SERVER_KEY`
- provider API keys used by Hermes

Use `.env` locally and GitHub Actions secrets for automation.

## Reporting a Vulnerability

Please open a private security advisory on GitHub or contact the maintainer before publishing exploit details.
