# Discord Chatbot Intelligence API

An early, model-independent API prototype for a conversational intelligence engine. Mallow Bot is one possible test client; this project is not specific to Mallow Bot.

## Run locally

Requires Node.js 22 or newer.

```bash
npm test
npm start
```

The API listens on port 3000 by default. You can set `PORT` and `DATA_FILE` environment variables.

## Generate an API key

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"label":"My test bot"}'
```

The response contains a key beginning with `zai_`. Copy it immediately; the server only stores its SHA-256 hash.

## Verify a key

Replace `YOUR_KEY` with the returned key:

```bash
curl http://localhost:3000/v1/keys \
  -H "Authorization: Bearer YOUR_KEY"
```

## Current endpoints

- `GET /health` — health check.
- `POST /v1/keys` — create an API key; limited to 5 creations per IP per minute in this prototype.
- `GET /v1/keys` — verify a key.
- `POST /v1/chat/completions` — validates a key and request, but currently returns HTTP 501 because the intelligence engine is not implemented yet.

## Important prototype limitations

- This is not yet a hosted public API. Deploy it to a server before using a key from another application.
- Key records are stored in a local JSON file. Use durable storage and stronger distributed rate limiting before production.
- Public key creation has only a basic in-memory rate limit. Add abuse prevention before exposing it to the internet.
- GitHub Actions runs automated tests; it does not publish or expose a production API key.
- No paid AI provider or external model is used.
